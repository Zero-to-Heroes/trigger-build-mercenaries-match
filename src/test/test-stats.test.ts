import { parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { MercenariesReferenceData } from '../process-mercenaries-review';
import { ReviewMessage } from '../review-message';
import { Stat } from '../stat';
import { extractStats } from '../stats-extractor';
import { http } from '../utils/util-functions';
import { xml } from './merc_solo_bounty.xml';

const doTest = async () => {
	const replayString: string = xml;
	const replay: Replay = parseHsReplayString(replayString);
	console.debug('result', replay.result);
	console.debug('scenarioId', replay.scenarioId);
	console.debug('playerId', replay.mainPlayerId)
	console.debug('opponentId', replay.opponentPlayerId)
	let mercenariesReferenceData: MercenariesReferenceData = JSON.parse(
		await http(`https://static.zerotoheroes.com/hearthstone/data/mercenaries-data.json?v=3`),
	);
	const allCards = new AllCardsService();
	await allCards.initializeCardsDb('95431-6');
	const statsFromGame: readonly Stat[] = await extractStats(
		{
			gameMode: 'mercenaries-pve',
		} as ReviewMessage,
		replay,
		replayString,
		mercenariesReferenceData,
		allCards,
	);
	console.debug('statsFromGame', statsFromGame);
};

doTest();
