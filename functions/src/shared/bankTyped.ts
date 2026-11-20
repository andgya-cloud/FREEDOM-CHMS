/**
 * Typed bank balances (Andy, 2026-11-20): Andrew Guya, Doreen Mayaka, Elias Omondi and Daniel Ojwang' may type
 * the bank balance (1A). Andrew and Doreen need no PIN; Elias and Daniel type their own PIN (2A). The record
 * keeps who typed it.
 */
export const BANK_TYPER_NAMES = ['Andrew Guya', 'Doreen Mayaka', 'Doreen Guya', 'Elias Omondi', "Daniel Ojwang'"] as const;
const NO_PIN_NAMES = ['Andrew Guya', 'Doreen Mayaka', 'Doreen Guya'];
const plain = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');
export const canTypeBankBalance = (name: string) => BANK_TYPER_NAMES.some((n) => plain(n) === plain(name));
export const typesWithoutPin = (name: string) => NO_PIN_NAMES.some((n) => plain(n) === plain(name));
