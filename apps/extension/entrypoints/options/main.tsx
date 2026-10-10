import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import '../../src/autofill/ui/base.css';
import '../sidepanel/style.css';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
