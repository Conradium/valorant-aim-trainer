import React, { useState } from 'react';
import Landing from './Landing.jsx';
import AimTrainer from './AimTrainer.jsx';

export default function App() {
  const [view, setView] = useState('landing'); // 'landing' | 'play'
  const [lang, setLang] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('vat_settings'));
      return saved && saved.lang ? saved.lang : 'en';
    } catch {
      return 'en';
    }
  });

  const handleSetLang = (newLang) => {
    setLang(newLang);
    try {
      const saved = JSON.parse(localStorage.getItem('vat_settings')) || {};
      saved.lang = newLang;
      localStorage.setItem('vat_settings', JSON.stringify(saved));
    } catch {
      /* ignore */
    }
  };

  if (view === 'landing') {
    return <Landing onPlay={() => setView('play')} lang={lang} setLang={handleSetLang} />;
  }
  return <AimTrainer onExit={() => setView('landing')} lang={lang} setLang={handleSetLang} />;
}
