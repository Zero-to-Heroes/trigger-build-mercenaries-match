import { parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { ServerlessMysql } from 'serverless-mysql';
import SqlString from 'sqlstring';
import { getConnection } from './db/rds';
import { S3 } from './db/s3';
import { mercsHeroesInfosExtractor } from './mercenaries/heroes-info-extractor';
import { ReviewMessage } from './review-message';
import { Stat } from './stat';
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
		mercenariesReferenceData = await http(`https://static.zerotoheroes.com/api/mercenaries-data.json?v=2`);
	}
	for (const message of messages) {
		await handleReview(message, mysql);
	}
	await mysql.end();
	return { statusCode: 200, body: null };
};

const handleReview = async (message: ReviewMessage, mysql: ServerlessMysql): Promise<void> => {
	if (!isMercenaries(message.gameMode)) {
		console.log('not mercenaries', message);
		return;
	}
	await allCards.initializeCardsDb();

	const replayString = await loadReplayString(message.replayKey);
	if (!replayString || replayString.length === 0) {
		return null;
	}

	const replay: Replay = parseHsReplayString(replayString);
	const statsFromGame: readonly Stat[] = await extractStats(message, replay, replayString);

	const heroTimings = statsFromGame
		.filter(stat => stat.statName === 'mercs-hero-timing')
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
				mercHeroSkills = ${escape(heroSkillsUsed)}
			WHERE
				reviewId = ${escape(message.reviewId)}
		`;
	console.log('running second query', replaySumaryUpdateQuery);
	await mysql.query(replaySumaryUpdateQuery);

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
				.map(stat => stat.statValue.split('|')[0]);
			const equipmentCardId = normalizeMercCardId(findEquipmentForHero(allEquipmentCardIds, heroCardId));
			const spellsForHero = getSpellsForHero(
				statsFromGame.filter(stat => stat.statName === 'mercs-hero-skill-used'),
				heroCardId,
			);
			return `(
				${escape(message.creationDate)},
				${escape(message.reviewId)},
				${escape(message.scenarioId)},
				${escape(message.result)},
				${escape(!isNaN(parseInt(message.playerRank)) ? parseInt(message.playerRank) : null)},
				${escape(isNaN(parseInt(message.playerRank)) ? message.playerRank : null)},
				${escape(message.buildNumber)},
				${escape(heroCardId)},
				${escape(heroTiming)},
				${escape(equipmentCardId)},
				${escape(spellsForHero.length > 0 ? spellsForHero[0].spellCardId : null)},
				${escape(spellsForHero.length > 0 ? spellsForHero[0].level : null)},
				${escape(spellsForHero.length > 0 ? spellsForHero[0].numberOfTimesUsed : null)},
				${escape(spellsForHero.length > 1 ? spellsForHero[1].spellCardId : null)},
				${escape(spellsForHero.length > 1 ? spellsForHero[1].level : null)},
				${escape(spellsForHero.length > 1 ? spellsForHero[1].numberOfTimesUsed : null)},
				${escape(spellsForHero.length > 2 ? spellsForHero[2].spellCardId : null)},
				${escape(spellsForHero.length > 2 ? spellsForHero[2].level : null)},
				${escape(spellsForHero.length > 2 ? spellsForHero[2].numberOfTimesUsed : null)},
			)`;
		})
		.join(',\n');
	const statsQuery = `
		INSERT INTO mercenaries_match_stats
		(
			startDate,
			reviewId,
			scenarioId,
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
	console.log('running query', statsQuery);
	await mysql.query(statsQuery);
};

export const extractStats = async (
	message: ReviewMessage,
	replay: Replay,
	replayString: string,
): Promise<readonly Stat[]> => {
	const extractors = [mercsHeroesInfosExtractor];
	const stats: readonly Stat[] = (
		await Promise.all(
			extractors.map(extractor => extractor(message, replay, replayString, allCards, mercenariesReferenceData)),
		)
	)
		.reduce((a, b) => a.concat(b), [])
		.filter(stat => stat);
	return stats;
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

const findEquipmentForHero = (allEquipmentCardIds: string[], heroCardId: string): string => {
	const heroEquipmentCardIds = mercenariesReferenceData.mercenaries
		.find(merc => merc.cardId === heroCardId)
		.equipments.map(eq => eq.cardDbfId)
		.map(eqDbfId => allCards.getCardFromDbfId(eqDbfId).id);
	const candidates: readonly string[] = heroEquipmentCardIds.filter(e => allEquipmentCardIds.includes(e));
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
): { spellCardId: string; numberOfTimesUsed: number; level: number }[] => {
	const heroAbilityCardIds = mercenariesReferenceData.mercenaries
		.find(merc => merc.cardId === heroCardId)
		.abilities.map(ability => ability.cardDbfId)
		.map(abilityDbfId => allCards.getCardFromDbfId(abilityDbfId).id);
	const allSpellCardIds = stats.map(stat => stat.statValue.split('|')[0]);
	const heroSpellCardIds = allSpellCardIds.filter(s => heroAbilityCardIds.includes(normalizeMercCardId(s)));
	return heroSpellCardIds.sort().map(spellCardId => ({
		spellCardId: spellCardId,
		numberOfTimesUsed: parseInt(stats.find(stat => stat.statValue.startsWith(spellCardId)).statValue.split('|')[1]),
		level: getCardLevel(spellCardId),
	}));
};

export interface MercenariesReferenceData {
	readonly mercenaries: readonly {
		readonly id: number;
		readonly cardId: string;
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
