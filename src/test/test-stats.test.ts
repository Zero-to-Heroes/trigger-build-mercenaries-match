import { parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { extractStats } from '../process-mercenaries-review';
import { ReviewMessage } from '../review-message';
import { Stat } from '../stat';
import { xml } from './merc_solo_pvp.xml';

const doTest = async () => {
	const replayString: string = xml;
	const replay: Replay = parseHsReplayString(replayString);
	console.debug('result', replay.result);
	console.debug('scenarioId', replay.scenarioId);
	const statsFromGame: readonly Stat[] = await extractStats(
		{
			gameMode: 'mercenaries-pve',
		} as ReviewMessage,
		replay,
		replayString,
	);
	console.debug('statsFromGame', statsFromGame);
};

doTest();
