import React, { useState } from 'react';

export default function Login({ onJoin }) {
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('global');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim()) return alert('Please enter a username');
    onJoin(username.trim(), room.trim() || 'global');
  };

  return (
    <div className="login">
      <h2>Join Chat</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. Bobby"
            maxLength={20}
          />
        </label>
        <label>
          Room
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="room name (global)"
            maxLength={30}
          />
        </label>
        <button type="submit">Join</button>
      </form>
      <p className="hint">Tip: Use different rooms to test in multiple tabs</p>
    </div>
  );
}
