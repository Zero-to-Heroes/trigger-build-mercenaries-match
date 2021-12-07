import { parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService, ScenarioId } from '@firestone-hs/reference-data';
import { buildInsertQuery, MercenariesReferenceData } from '../process-mercenaries-review';
import { ReviewMessage } from '../review-message';
import { Stat } from '../stat';
import { extractStats } from '../stats-extractor';
import { http } from '../utils/util-functions';
import { xml } from './merc_solo_pvp.xml';

const doTest = async () => {
	const replayString: string = xml;
	const reviewMessage: ReviewMessage = {
		scenarioId: ScenarioId.LETTUCE_PVP,
	} as ReviewMessage;

	const replay: Replay = parseHsReplayString(replayString);
	console.debug('result', replay.result);
	console.debug('scenarioId', replay.scenarioId);
	console.debug('opponnet', replay.opponentPlayerName);
	console.debug('playerId', replay.mainPlayerId);
	console.debug('opponentId', replay.opponentPlayerId);
	const mercenariesReferenceData: MercenariesReferenceData = JSON.parse(
		await http(`https://static.zerotoheroes.com/hearthstone/data/mercenaries-data.json?v=6`),
	);
	// console.debug('ref data', mercenariesReferenceData);
	const allCards = new AllCardsService();
	await allCards.initializeCardsDb('ijezogijeogijerog');
	const statsFromGame: readonly Stat[] = await extractStats(
		{
			gameMode: 'mercenaries-pve',
		} as ReviewMessage,
		replay,
		null,
		mercenariesReferenceData,
		allCards,
	);
	console.debug('statsFromGame', statsFromGame);
	const insertQuery = buildInsertQuery(reviewMessage, statsFromGame, allCards, mercenariesReferenceData);
	// console.debug('insertQuery', insertQuery);
};

doTest();
