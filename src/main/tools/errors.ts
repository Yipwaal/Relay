/**
 * Fout in wat het model als tool-argument meegaf (ontbrekend, leeg, ongeldige
 * URL). Telt mee voor escalatie naar een slimmer model; een netwerkfout of
 * ontbrekende API-key niet — daar helpt een groter model niet tegen.
 */
export class ToolInputError extends Error {}
