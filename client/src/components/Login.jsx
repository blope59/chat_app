import React, { useState } from "react";

export default function Login({ onLogin, switchToSignup }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleLogin(e) {
    e.preventDefault();
    try {
      const res = await fetch("http://localhost:3001/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem("token", data.token);
        onLogin(data.username, "global"); // start in global room
      } else {
        alert("Login failed: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Login request failed.");
    }
  }

  return (
    <div className="login">
      <h2>Login</h2>
      <form onSubmit={handleLogin}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit">Login</button>
      </form>
      <p>
        Don’t have an account?{" "}
        <button type="button" onClick={() => switchToSignup(true)}>
          Sign up
        </button>
      </p>
    </div>
  );
}
