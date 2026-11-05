import { createContext, useContext } from 'react';

export const AuthContext = createContext({ user: null, onLogout: () => {} });
export const useAuth = () => useContext(AuthContext);