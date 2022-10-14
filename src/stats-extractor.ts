import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { mercsHeroesInfosExtractor } from './mercenaries/heroes-info-extractor';
import { MercenariesReferenceData } from './process-mercenaries-review';
import { ReviewMessage } from './review-message';
import { Stat } from './stat';

export const extractStats = (
	message: ReviewMessage,
	replay: Replay,
	replayString: string,
	mercenariesReferenceData: MercenariesReferenceData,
	allCards: AllCardsService,
): readonly Stat[] => {
	const extractors = [mercsHeroesInfosExtractor];
	const stats: readonly Stat[] = extractors
		.map(extractor => extractor(message, replay, replayString, allCards, mercenariesReferenceData))
		.reduce((a, b) => a.concat(b), [])
		.filter(stat => stat);
	return stats;
};
