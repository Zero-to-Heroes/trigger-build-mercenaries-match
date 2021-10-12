import { parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { extractStats, MercenariesReferenceData } from '../process-mercenaries-review';
import { ReviewMessage } from '../review-message';
import { Stat } from '../stat';
import { http } from '../utils/util-functions';
import { xml } from './merc_solo_pvp.xml';

const doTest = async () => {
	const replayString: string = xml;
	const replay: Replay = parseHsReplayString(replayString);
	console.debug('result', replay.result);
	console.debug('scenarioId', replay.scenarioId);
	let mercenariesReferenceData: MercenariesReferenceData = JSON.parse(
		await http(`https://static.zerotoheroes.com/hearthstone/data/mercenaries-data.json?v=3`),
	);
	const statsFromGame: readonly Stat[] = await extractStats(
		{
			gameMode: 'mercenaries-pve',
		} as ReviewMessage,
		replay,
		replayString,
		mercenariesReferenceData,
	);
	console.debug('statsFromGame', statsFromGame);
};

doTest();
