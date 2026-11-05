import { useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LoginScreen from './src/screens/LoginScreen';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthContext } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { getStoredUser, logout } from './src/api';
import { colors } from './src/theme/colors';

function Root() {
  const { mode, ready: themeReady } = useTheme();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getStoredUser().then((u) => { setUser(u); setReady(true); });
  }, []);

  const auth = useMemo(() => ({ user, onLogout: async () => { await logout(); setUser(null); } }), [user]);

  if (!ready || !themeReady) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.navy }}><ActivityIndicator color={colors.primary} /></View>;
  }

  // key={mode} remounts the tree so every themed style/color is re-read after a toggle
  return (
    <View key={mode} style={{ flex: 1, backgroundColor: colors.navy }}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      {user ? (
        <AuthContext.Provider value={auth}>
          <AppNavigator />
        </AuthContext.Provider>
      ) : (
        <LoginScreen onLoggedIn={setUser} />
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}