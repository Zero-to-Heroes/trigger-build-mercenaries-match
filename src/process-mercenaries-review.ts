import { extractTotalTurns, parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService, ScenarioId } from '@firestone-hs/reference-data';
import { normalize } from 'path';
import { ServerlessMysql } from 'serverless-mysql';
import SqlString from 'sqlstring';
import { getConnection } from './db/rds';
import { S3 } from './db/s3';
import { mercsHeroesInfosExtractor } from './mercenaries/heroes-info-extractor';
import { ReviewMessage } from './review-message';
import { Stat } from './stat';
import { extractStats } from './stats-extractor';
import { getCardLevel, isMercenaries, normalizeMercCardId } from './utils/hs-utils';
import { http } from './utils/util-functions';

const allCards = new AllCardsService();
const s3 = new S3();
let mercenariesReferenceData: MercenariesReferenceData = null;

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	const messages: readonly ReviewMessage[] = (event.Records as any[])
		.map(event => JSON.parse(event.body))
		.reduce((a, b) => a.concat(b), [])
		.filter(event => event)
		.map(event => event.Message)
		.filter(msg => msg)
		.map(msg => JSON.parse(msg));
	const mysql = await getConnection();
	if (!mercenariesReferenceData) {
		const strReferenceData = await http(
			`https://static.zerotoheroes.com/hearthstone/data/mercenaries-data.json?v=3`,
		);
		// console.log('found reference data', strReferenceData?.length);
		mercenariesReferenceData = JSON.parse(strReferenceData);
		// console.log('parsed reference data', mercenariesReferenceData);
	}
	// console.log('mercenaries reference data', mercenariesReferenceData);
	for (const message of messages) {
		await handleReview(message, mysql);
	}
	await mysql.end();
	return { statusCode: 200, body: null };
};

const handleReview = async (message: ReviewMessage, mysql: ServerlessMysql): Promise<void> => {
	if (!isMercenaries(message.gameMode)) {
		// console.log('not mercenaries', message);
		return;
	}

	const scenarioId = +message.scenarioId;
	if (scenarioId !== ScenarioId.LETTUCE_PVP) {
		// console.log('limiting to PvP stats for now, returning');
		return;
	}

	// if (
	// 	scenarioId === ScenarioId.LETTUCE_MAP_PVE &&
	// 	(!message.playerRank || !['normal', 'heroic', 'legendary'].includes(message.playerRank))
	// ) {
	// 	console.error('invalid difficulty for PvE', message);
	// 	return;
	// }

	// if (
	// 	scenarioId === ScenarioId.LETTUCE_MAP_PVE &&
	// 	(!message.mercBountyId ||
	// 		(message.mercBountyId as any) === 'undefined' ||
	// 		isNaN(parseInt(message.mercBountyId as any)))
	// ) {
	// 	console.error('missing bounty id for PvE', message);
	// 	return;
	// }

	if (scenarioId === ScenarioId.LETTUCE_PVP && (!message.playerRank || isNaN(parseInt(message.playerRank)))) {
		// console.error('invalid rating for PvP', message);
		return;
	}

	// Leagues that were formatted
	if (scenarioId === ScenarioId.LETTUCE_PVP && +message.playerRank >= 1 && +message.playerRank <= 5) {
		// console.error('invalid rating for PvP', message);
		return;
	}

	console.log(
		'processing',
		message,
		// scenarioId === ScenarioId.LETTUCE_MAP_PVE ? isNaN(parseInt(message.mercBountyId as any)) : null,
	);

	await allCards.initializeCardsDb('121569');

	const replayString = await loadReplayString(message.replayKey);
	if (!replayString || replayString.length === 0) {
		return null;
	}

	const replay: Replay = parseHsReplayString(replayString);
	const numberOfTurns = extractTotalTurns(replay);
	if (numberOfTurns <= 3) {
		console.log('game too short, not including it for stats', numberOfTurns);
		return;
	}

	const statsFromGame: readonly Stat[] = await extractStats(
		message,
		replay,
		replayString,
		mercenariesReferenceData,
		allCards,
	);

	if (!statsFromGame.filter(stat => stat.statName === 'mercs-hero-timing').length) {
		// console.log('no hero timings, returning', statsFromGame);
		return;
	}

	const heroTimings = statsFromGame
		.filter(stat => stat.statName === 'mercs-hero-timing')
		.map(stat => stat.statValue)
		.join(',');
	const opponentHeroTimings = statsFromGame
		.filter(stat => stat.statName === 'opponent-mercs-hero-timing')
		.map(stat => stat.statValue)
		.join(',');
	const heroEquipments = statsFromGame
		.filter(stat => stat.statName === 'mercs-hero-equipment')
		.map(stat => stat.statValue)
		.join(',');
	const heroLevels = statsFromGame
		.filter(stat => stat.statName === 'mercs-hero-level')
		.map(stat => stat.statValue)
		.join(',');
	const heroSkillsUsed = statsFromGame
		.filter(stat => stat.statName === 'mercs-hero-skill-used')
		.map(stat => stat.statValue)
		.join(',');

	const escape = SqlString.escape;
	// And now insert it in the new table
	const replaySumaryUpdateQuery = `
			UPDATE replay_summary
			SET
				mercHeroTimings = ${escape(heroTimings)},
				mercHeroEquipments = ${escape(heroEquipments)},
				mercHeroLevels = ${escape(heroLevels)},
				mercHeroSkills = ${escape(heroSkillsUsed)},
				mercOpponentHeroTimings = ${escape(opponentHeroTimings)}
			WHERE
				reviewId = ${escape(message.reviewId)}
		`;
	// console.log('running second query', replaySumaryUpdateQuery);
	await mysql.query(replaySumaryUpdateQuery);

	const statsQuery = buildInsertQuery(message, statsFromGame, allCards, mercenariesReferenceData);
	// console.log('running query', statsQuery);
	await mysql.query(statsQuery);
};

export const buildInsertQuery = (
	message: ReviewMessage,
	statsFromGame: readonly Stat[],
	allCards: AllCardsService,
	mercenariesReferenceData: MercenariesReferenceData,
): string => {
	const escape = SqlString.escape;
	const scenarioId = +message.scenarioId;

	// And now populate the second table
	const uniqueHeroIds = statsFromGame
		.filter(stat => stat.statName === 'mercs-hero-timing')
		.map(stat => stat.statValue)
		.map(value => value.split('|')[0]);
	const values = uniqueHeroIds
		.map(heroCardId => {
			const heroTiming = parseInt(
				statsFromGame
					.filter(stat => stat.statName === 'mercs-hero-timing')
					.map(stat => stat.statValue)
					.find(value => value.startsWith(heroCardId))
					.split('|')[1],
			);
			// Find the only equipment that could fit the hero
			const allEquipmentCardIds = statsFromGame
				.filter(stat => stat.statName === 'mercs-hero-equipment')
				.map(stat => stat.statValue.split('|')[1]);
			// console.log(
			// 	'allEquipmentCardIds',
			// 	allEquipmentCardIds,
			// 	statsFromGame.filter(stat => stat.statName === 'mercs-hero-equipment'),
			// );
			const equipmentCardId = findEquipmentForHero(
				allEquipmentCardIds,
				normalizeMercCardId(heroCardId),
				allCards,
				mercenariesReferenceData,
			);
			const normalizedEquipmentCardId = normalizeMercCardId(equipmentCardId);
			// console.log('equipmentCardId', normalizedEquipmentCardId);
			// console.log(
			// 	'spellsFromStats',
			// 	statsFromGame.filter(stat => stat.statName === 'mercs-hero-skill-used'),
			// );
			const spellsForHero = getSpellsForHero(
				statsFromGame.filter(stat => stat.statName === 'mercs-hero-skill-used'),
				heroCardId,
				allCards,
				mercenariesReferenceData,
			);
			// console.log('spellsForHero', spellsForHero);
			const heroLevel = parseInt(
				statsFromGame
					.filter(stat => stat.statName === 'mercs-hero-level')
					.map(stat => stat.statValue)
					.find(level => level.startsWith(heroCardId))
					.split('|')[1],
			);
			return `(
				${escape(message.creationDate)},
				${escape(message.reviewId)},
				${escape(scenarioId)},
				${escape(isNaN(parseInt(message.mercBountyId as any)) ? null : message.mercBountyId)},
				${escape(message.result)},
				${escape(scenarioId === ScenarioId.LETTUCE_PVP ? parseInt(message.playerRank) : null)},
				${escape(['normal', 'heroic', 'legendary'].includes(message.playerRank) ? message.playerRank : null)},
				${escape(+message.buildNumber)},
				${escape(heroCardId)},
				${escape(heroTiming)},
				${escape(normalizedEquipmentCardId)},
				${escape(heroLevel)},
				${escape(getCardLevel(equipmentCardId))},
				${escape(spellsForHero.length > 0 ? spellsForHero[0].spellCardId : null)},
				${escape(spellsForHero.length > 0 ? spellsForHero[0].level : null)},
				${escape(spellsForHero.length > 0 ? spellsForHero[0].numberOfTimesUsed : null)},
				${escape(spellsForHero.length > 1 ? spellsForHero[1].spellCardId : null)},
				${escape(spellsForHero.length > 1 ? spellsForHero[1].level : null)},
				${escape(spellsForHero.length > 1 ? spellsForHero[1].numberOfTimesUsed : null)},
				${escape(spellsForHero.length > 2 ? spellsForHero[2].spellCardId : null)},
				${escape(spellsForHero.length > 2 ? spellsForHero[2].level : null)},
				${escape(spellsForHero.length > 2 ? spellsForHero[2].numberOfTimesUsed : null)}
			)`;
		})
		.join(',\n');
	const statsQuery = `
		INSERT INTO mercenaries_match_stats
		(
			startDate,
			reviewId,
			scenarioId,
			bountyId,
			result,
			rating,
			difficulty,
			buildNumber,
			heroCardId,
			battleEnterTiming,
			equipmentCardId,
			heroLevel,
			equipmentLevel,
			firstSkillCardId,
			firstSkillLevel,
			firstSkillNumberOfTimesUsed,
			secondSkillCardId,
			secondSkillLevel,
			secondSkillNumberOfTimesUsed,
			thirdSkillCardId,
			thirdSkillLevel,
			thirdSkillNumberOfTimesUsed
		)
		VALUES 
		${values}
	`;
	return statsQuery;
};

export const loadReplayString = async (replayKey: string): Promise<string> => {
	if (!replayKey) {
		return null;
	}
	const data = replayKey.endsWith('.zip')
		? await s3.readZippedContent('xml.firestoneapp.com', replayKey)
		: await s3.readContentAsString('xml.firestoneapp.com', replayKey);
	return data;
};

const emptyAsNull = (value: string): string => {
	if (value?.length === 0) {
		return null;
	}
	return value;
};

const findEquipmentForHero = (
	allEquipmentCardIds: string[],
	heroCardId: string,
	allCards: AllCardsService,
	mercenariesReferenceData: MercenariesReferenceData,
): string => {
	const refMerc = mercenariesReferenceData.mercenaries.find(
		merc => normalizeMercCardId(allCards.getCardFromDbfId(merc.cardDbfId).id) === normalizeMercCardId(heroCardId),
	);
	// Can happen when facing summoned minions
	if (!refMerc) {
		return null;
	}
	// console.log('refMerc', refMerc, heroCardId);
	const refMercEquipmentTiers = refMerc?.equipments.map(eq => eq.tiers).reduce((a, b) => a.concat(b), []);
	// console.log('refMercEquipmentTiers', refMercEquipmentTiers);
	const heroEquipmentCardIds =
		refMercEquipmentTiers.map(eq => eq.cardDbfId).map(eqDbfId => allCards.getCardFromDbfId(eqDbfId).id) ?? [];
	const candidates: readonly string[] = heroEquipmentCardIds.filter(e => allEquipmentCardIds.includes(e));
	// console.log('candidates', heroCardId, candidates);
	if (candidates.length === 0) {
		return null;
	}

	if (candidates.length > 1) {
		console.error('could not get correct equipment for hero', heroCardId, heroEquipmentCardIds, candidates);
	}

	return candidates[0];
};

const getSpellsForHero = (
	stats: Stat[],
	heroCardId: string,
	allCards: AllCardsService,
	mercenariesReferenceData: MercenariesReferenceData,
): { spellCardId: string; numberOfTimesUsed: number; level: number }[] => {
	const heroAbilityCardIds =
		mercenariesReferenceData.mercenaries
			.find(
				merc =>
					normalizeMercCardId(allCards.getCardFromDbfId(merc.cardDbfId).id) ===
					normalizeMercCardId(heroCardId),
			)
			?.abilities.map(ability => ability.tiers)
			.reduce((a, b) => a.concat(b), [])
			.map(ability => ability.cardDbfId)
			.map(abilityDbfId => allCards.getCardFromDbfId(abilityDbfId).id) ?? [];
	// console.log('heroAbilityCardIds', heroAbilityCardIds);
	const allSpellCardIds = stats.map(stat => stat.statValue.split('|')[0]);
	// console.log('allSpellCardIds', allSpellCardIds);
	const heroSpellCardIds = allSpellCardIds.filter(s => heroAbilityCardIds.includes(s));
	// console.log('heroSpellCardIds', heroSpellCardIds);
	return heroSpellCardIds.sort().map(spellCardId => ({
		spellCardId: normalizeMercCardId(spellCardId),
		numberOfTimesUsed: parseInt(stats.find(stat => stat.statValue.startsWith(spellCardId)).statValue.split('|')[1]),
		level: getCardLevel(spellCardId),
	}));
};

export interface MercenariesReferenceData {
	readonly mercenaries: readonly {
		readonly id: number;
		readonly cardDbfId: number;
		readonly name: string;
		readonly specializationId: number;
		readonly specializationName: string;
		readonly abilities: readonly {
			readonly abilityId: number;
			readonly cardDbfId: number;
			readonly mercenaryRequiredLevel: number;
			readonly tiers: readonly {
				readonly tier: number;
				readonly cardDbfId: number;
				readonly coinCraftCost: number;
			}[];
		}[];
		readonly equipments: readonly {
			readonly equipmentId: number;
			readonly cardDbfId: number;
			readonly tiers: readonly {
				readonly tier: number;
				readonly cardDbfId: number;
				readonly coinCraftCost: number;
				readonly attackModifier: number;
				readonly healthModifier: number;
			}[];
		}[];
	}[];
	readonly mercenaryLevels: readonly {
		readonly currentLevel: number;
		readonly xpToNext: number;
	}[];
	readonly bountySets: readonly {
		readonly id: number;
		readonly name: string;
		readonly descriptionNormal: string;
		readonly descriptionHeroic: string;
		readonly descriptionLegendary: string;
		readonly sortOrder: number;
		readonly bounties: readonly {
			readonly id: number;
			readonly name: string;
			readonly level: number;
			readonly enabled: number;
			readonly difficultyMode: number;
			readonly heroic: number;
			readonly finalBossCardId: number;
			readonly sortOrder: number;
			readonly requiredCompletedBountyId: number;
			readonly rewardMercenaryIds: readonly number[];
		}[];
	}[];
}
