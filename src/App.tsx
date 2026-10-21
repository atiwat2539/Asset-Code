import React from 'react';
import { AppProviders } from './app/providers';
import { AppRouter } from './app/router';

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}

export default App;
