import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { applyPalette, colors } from '../theme/colors';

const KEY = 'theme_mode';
const ThemeContext = createContext({ mode: 'light', colors, toggleTheme: () => {}, ready: true });

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(KEY).then((m) => {
      const v = m === 'dark' ? 'dark' : 'light';
      applyPalette(v); setMode(v);
    }).catch(() => {}).finally(() => setReady(true));
  }, []);

  const setTheme = useCallback((v) => {
    applyPalette(v); setMode(v);
    SecureStore.setItemAsync(KEY, v).catch(() => {});
  }, []);
  const toggleTheme = useCallback(() => setTheme(mode === 'dark' ? 'light' : 'dark'), [mode, setTheme]);

  return <ThemeContext.Provider value={{ mode, colors, toggleTheme, setTheme, ready }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);