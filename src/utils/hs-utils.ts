export const isMercenaries = (gameMode: string): boolean => {
	return [
		'mercenaries-pve',
		'mercenaries-pvp',
		'mercenaries-pve-coop',
		'mercenaries-ai-vs-ai',
		'mercenaries-friendly',
	].includes(gameMode);
};

export const normalizeMercCardId = (cardId: string): string => {
	if (!cardId) {
		return cardId;
	}

	// Generic handling of mercenaries skins or levelling
	const skinMatch = cardId.match(/.*_(\d\d)$/);
	if (skinMatch) {
		return cardId.replace(/(.*)(_\d\d)$/, '$1_01');
	}
	return cardId;
};

export const getCardLevel = (cardId: string): number => {
	if (!cardId) {
		return 0;
	}

	// Generic handling of mercenaries skins or levelling
	const skinMatch = cardId.match(/.*_(\d\d)$/);
	if (skinMatch) {
		return parseInt(skinMatch[1]);
	}
	return 0;
};
