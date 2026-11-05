import { StyleSheet } from 'react-native';

// Marcosquay green theme. Keys `navy` (screen background) and `navyLight` (card surface)
// are kept for backwards compatibility with existing screens.
export const palettes = {
  light: {
    navy: '#F5F8F6', navyLight: '#FFFFFF', primary: '#1E8E3E', primaryDark: '#166B2F',
    text: '#0F1A14', heading: '#0F1A14', subtext: '#475569', meta: '#6B7A72', muted: '#6B7A72',
    border: '#E3EAE5', cardBorder: '#E3EAE5', iconMuted: '#9AA8A0', placeholder: '#E8F5EC',
    primarySoft: '#E8F5EC', accentGreen: '#E8F5EC', accentBlue: '#EAF1FD', accentOrange: '#FFF1E6',
    inputBg: '#FFFFFF', success: '#1E8E3E', successSoft: '#E8F5EC', bg: '#FFFFFF',
    error: '#dc2626', errorBg: '#fef2f2', onPrimary: '#FFFFFF',
  },
  dark: {
    navy: '#121614', navyLight: '#1C211E', primary: '#22A84A', primaryDark: '#1E8E3E',
    text: '#E8EDEA', heading: '#F1F5F2', subtext: '#B8C4BD', meta: '#8A988F', muted: '#8A988F',
    border: '#2A322D', cardBorder: '#2A322D', iconMuted: '#5E6B63', placeholder: '#243029',
    primarySoft: 'rgba(34,168,74,0.18)', accentGreen: 'rgba(34,168,74,0.15)', accentBlue: 'rgba(96,140,230,0.15)', accentOrange: 'rgba(255,150,70,0.15)',
    inputBg: '#232925', success: '#4ade80', successSoft: 'rgba(34,168,74,0.2)', bg: '#1C211E',
    error: '#f87171', errorBg: '#3a1f1f', onPrimary: '#FFFFFF',
  },
};

// Live palette object: mutated in place when the theme changes, so `colors.x` read at render is current.
export const colors = { ...palettes.light };
export let currentMode = 'light';

const builders = [];
// Theme-aware StyleSheet: rebuilt in place on theme change.
export function themed(fn) {
  const obj = {};
  const build = () => Object.assign(obj, StyleSheet.create(fn()));
  builders.push(build);
  build();
  return obj;
}

export function applyPalette(mode) {
  currentMode = mode === 'dark' ? 'dark' : 'light';
  Object.assign(colors, palettes[currentMode]);
  builders.forEach((b) => b());
}