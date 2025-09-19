import React, { useState } from "react";
import Login from "./components/Login";
import Signup from "./components/Signup";
import Chat from "./components/Chat";

function App() {
  const [user, setUser] = useState(null);
  const [showSignup, setShowSignup] = useState(false);

  return (
    <div className="app">
      {!user ? (
        showSignup ? (
          <Signup onSignup={() => setShowSignup(false)} />
        ) : (
          <Login
            onLogin={(username, room) => setUser({ username, room })}
            switchToSignup={setShowSignup}
          />
        )
      ) : (
        <Chat user={user} onLeave={() => setUser(null)} />
      )}
    </div>
  );
}

export default App;
