import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Element } from 'elementtree';
import { MercenariesReferenceData } from '../../process-mercenaries-review';
import { normalizeMercCardId } from '../../utils/hs-utils';
import { Parser, ParsingStructure } from '../mercs-replay-crawler';

export class HeroesLevelParser implements Parser {
	levelMapping: { [heroCardId: string]: number } = {};

	constructor(private readonly mercenariesReferenceData: MercenariesReferenceData) {}

	parse = (structure: ParsingStructure, replay: Replay) => {
		return (element: Element) => {};
	};

	populate = (structure: ParsingStructure, replay: Replay) => {
		return (currentTurn: number) => {};
	};

	finalize = (structure: ParsingStructure, replay: Replay) => {
		return (currentTurn: number) => {
			// Get all the mercs for the main player
			Object.values(structure.entities)
				.filter(e => e.isMerc)
				.filter(e => e.lettuceController === replay.mainPlayerId)
				.forEach(merc => {
					const heroCardId = normalizeMercCardId(merc.cardId);
					const totalXp = merc.experience;
					const currentLevel = getLevelFromXp(totalXp, this.mercenariesReferenceData);
					this.levelMapping[heroCardId] = currentLevel;
				});
		};
	};
}

const getLevelFromXp = (totalXp: number, mercenariesReferenceData: MercenariesReferenceData): number => {
	let currentLevel = 1;
	let xpToAttribute = totalXp;
	for (const levelMapping of mercenariesReferenceData.mercenaryLevels) {
		if (xpToAttribute < levelMapping.xpToNext) {
			break;
		}
		currentLevel++;
		xpToAttribute -= levelMapping.xpToNext;
	}
	// console.log(totalXp, 'maps to lvl', currentLevel);
	return currentLevel;
};
