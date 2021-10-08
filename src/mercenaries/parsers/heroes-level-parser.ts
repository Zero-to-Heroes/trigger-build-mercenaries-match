import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Element } from 'elementtree';
import { normalizeMercCardId } from '../../utils/hs-utils';
import { Parser, ParsingStructure } from '../mercs-replay-crawler';

export class HeroesLevelParser implements Parser {
	levelMapping: { [heroCardId: string]: number } = {};

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
					const currentLevel = getLevelFromXp(totalXp);
					this.levelMapping[heroCardId] = currentLevel;
				});
		};
	};
}

const getLevelFromXp = (totalXp: number): number => {
	let currentLevel = 1;
	let xpToAttribute = totalXp;
	for (const levelMapping of currentLevelToNextXpMapping) {
		if (xpToAttribute < levelMapping.xpToNext) {
			break;
		}
		currentLevel++;
		xpToAttribute -= levelMapping.xpToNext;
	}
	console.log(totalXp, 'maps to lvl', currentLevel);
	return currentLevel;
};

const currentLevelToNextXpMapping = [
	{ currentLevel: 1, xpToNext: 25 },
	{ currentLevel: 2, xpToNext: 60 },
	{ currentLevel: 3, xpToNext: 160 },
	{ currentLevel: 4, xpToNext: 300 },
	{ currentLevel: 5, xpToNext: 500 },
	{ currentLevel: 6, xpToNext: 800 },
	{ currentLevel: 7, xpToNext: 1350 },
	{ currentLevel: 8, xpToNext: 1900 },
	{ currentLevel: 9, xpToNext: 2500 },
	{ currentLevel: 10, xpToNext: 3300 },
	{ currentLevel: 11, xpToNext: 4200 },
	{ currentLevel: 12, xpToNext: 5300 },
	{ currentLevel: 13, xpToNext: 6500 },
	{ currentLevel: 14, xpToNext: 7900 },
	{ currentLevel: 15, xpToNext: 9400 },
	{ currentLevel: 16, xpToNext: 11100 },
	{ currentLevel: 17, xpToNext: 13100 },
	{ currentLevel: 18, xpToNext: 15300 },
	{ currentLevel: 19, xpToNext: 17600 },
	{ currentLevel: 20, xpToNext: 20150 },
	{ currentLevel: 21, xpToNext: 23000 },
	{ currentLevel: 22, xpToNext: 26000 },
	{ currentLevel: 23, xpToNext: 29300 },
	{ currentLevel: 24, xpToNext: 32900 },
	{ currentLevel: 25, xpToNext: 36600 },
	{ currentLevel: 26, xpToNext: 40700 },
	{ currentLevel: 27, xpToNext: 45100 },
	{ currentLevel: 28, xpToNext: 50000 },
	{ currentLevel: 29, xpToNext: 55000 },
];
