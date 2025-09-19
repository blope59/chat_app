import React, { useState } from 'react';
import Login from './components/Login';
import Chat from './components/Chat';

function App() {
  const [user, setUser] = useState(null);
  return (
    <div className="app">
      {!user ? (
        <Login onJoin={(username, room) => setUser({ username, room })} />
      ) : (
        <Chat user={user} onLeave={() => setUser(null)} />
      )}
    </div>
  );
}

export default App;
