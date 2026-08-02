import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import DistressScoutApp from './DistressScoutApp';
import ErrorBoundary from './ErrorBoundary';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <DistressScoutApp />
    </ErrorBoundary>
  </React.StrictMode>
);
