import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import axios from "axios";
import EmojiPicker from "emoji-picker-react";
import "./App.css";

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:3001";
// single socket
const socket = io(SERVER_URL, { transports: ["websocket"] });

function formatTimestamp(dateString) {
  const d = new Date(dateString);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const SingleCheck = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="tick-icon single" viewBox="0 0 24 24">
    <path d="M4 12l5 5L20 7" fill="none" stroke="gray" strokeWidth="2" />
  </svg>
);
const DoubleCheck = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="tick-icon double" viewBox="0 0 24 24">
    <path d="M3 12l5 5L20 5" fill="none" stroke="#00e5ff" strokeWidth="2" />
    <path d="M9 12l5 5L23 5" fill="none" stroke="#00e5ff" strokeWidth="2" />
  </svg>
);

export default function App() {
  // auth
  const [username, setUsername] = useState(null);
  const [token, setToken] = useState(null);
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", email: "", password: "", avatar: null  });

  // rooms
  const [room, setRoom] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [newRoom, setNewRoom] = useState("");

  // chat state
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState(null);

  // UI
  const [darkMode, setDarkMode] = useState(false);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);

  // refs
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const hideTimerRef = useRef(null);

  const messagesDiv = () => messagesEndRef.current?.parentNode;
  const scrollToBottom = (behavior = "smooth") => {
    const el = messagesDiv();
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };
  const nearBottom = () => {
    const el = messagesDiv();
    if (!el) return true;
    const { scrollTop, clientHeight, scrollHeight } = el;
    return scrollHeight - scrollTop <= clientHeight + 50;
  };

  // boot stored session + theme + last room
  useEffect(() => {
    const u = localStorage.getItem("chatUser");
    const t = localStorage.getItem("chatToken");
    const theme = localStorage.getItem("darkMode");
    const savedRoom = localStorage.getItem("chatRoom");

    if (u && t) {
      setUsername(u);
      setToken(t);
    }
    if (theme === "true") {
      setDarkMode(true);
      document.body.classList.add("dark");
    }
    if (savedRoom) setRoom(savedRoom);

    // prefetch rooms list
    axios.get(`${SERVER_URL}/rooms`).then((res) => setRooms(res.data || [])).catch(() => {});
  }, []);

  // auth handlers
  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      const url = `${SERVER_URL}/${mode}`;
      const res = await axios.post(url, form);
      setUsername(res.data.username);
      setToken(res.data.token);
      localStorage.setItem("chatUser", res.data.username);
      localStorage.setItem("chatToken", res.data.token);
    } catch (err) {
      alert(err.response?.data?.error || "Auth failed");
    }
  };
  const handleLogout = () => {
    setUsername(null);
    setToken(null);
    localStorage.removeItem("chatUser");
    localStorage.removeItem("chatToken");
    // also leave room
    setRoom(null);
    localStorage.removeItem("chatRoom");
    setMessages([]);
    setOnlineUsers([]);
  };
  const toggleDarkMode = () => {
    const v = !darkMode;
    setDarkMode(v);
    document.body.classList.toggle("dark", v);
    localStorage.setItem("darkMode", v);
  };

  // joining a room (select existing or create new)
  const joinRoom = async (targetRoom) => {
    const r = (targetRoom || newRoom || "").trim() || "general";
    setRoom(r);
    localStorage.setItem("chatRoom", r);

    // fetch that room's messages
    try {
      const res = await axios.get(`${SERVER_URL}/messages?room=${encodeURIComponent(r)}`);
      setMessages(res.data || []);
      // join socket room (needs username set)
      if (username) {
        socket.emit("joinRoom", { username, room: r });
      }
      // initial read sync
      setTimeout(() => {
        scrollToBottom("auto");
        if (username) socket.emit("markAsRead", { username, room: r });
      }, 30);
    } catch (err) {
      console.error("Failed to load room messages:", err);
    }

    // refresh rooms list (new custom gets added automatically)
    axios.get(`${SERVER_URL}/rooms`).then((res) => setRooms(res.data || [])).catch(() => {});
  };

  // load messages when username+room are both ready (e.g., after login)
  useEffect(() => {
    if (username && room) {
      socket.emit("joinRoom", { username, room });
      axios
        .get(`${SERVER_URL}/messages?room=${encodeURIComponent(room)}`)
        .then((res) => {
          setMessages(res.data || []);
          setTimeout(() => {
            scrollToBottom("auto");
            socket.emit("markAsRead", { username, room });
          }, 30);
        })
        .catch((e) => console.error("Failed to fetch messages:", e));
    }
  }, [username]); // eslint-disable-line

  // socket listeners (room-scoped)
  useEffect(() => {
    const receiveHandler = (message) => {
      // only accept messages for my current room
      if (message.room !== room) return;
      setMessages((prev) => [...prev, message]);

      if (message.username === username) {
        setTimeout(() => scrollToBottom(), 40);
      } else {
        if (!nearBottom()) {
          setNewMsgCount((c) => c + 1);
          setShowNewMessages(true);
          setFadeOut(false);
        } else {
          setTimeout(() => scrollToBottom(), 40);
        }
      }
    };

    const readHandler = (updatedMessages) => {
      // server emits full room messages; ensure they match current room
      if (!updatedMessages?.length || updatedMessages[0]?.room !== room) return;
      const map = new Map(updatedMessages.map((m) => [m._id, m]));
      setMessages((prev) => prev.map((m) => (map.has(m._id) ? { ...m, readBy: [...map.get(m._id).readBy] } : m)));
    };

    const onlineHandler = (users) => setOnlineUsers(users || []);
    const typingHandler = (who) => setTypingUser(who);
    const stopTypingHandler = () => setTypingUser(null);

    socket.on("receiveMessage", receiveHandler);
    socket.on("messageRead", readHandler);
    socket.on("onlineUsers", onlineHandler);
    socket.on("typing", typingHandler);
    socket.on("stopTyping", stopTypingHandler);

    return () => {
      socket.off("receiveMessage", receiveHandler);
      socket.off("messageRead", readHandler);
      socket.off("onlineUsers", onlineHandler);
      socket.off("typing", typingHandler);
      socket.off("stopTyping", stopTypingHandler);
    };
  }, [room, username]);

  // stay stuck to bottom when appropriate
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.username === username) {
      scrollToBottom();
    } else if (nearBottom()) {
      scrollToBottom();
    }
  }, [messages]); // eslint-disable-line

  // auto-hide for new message pill
  useEffect(() => {
    if (!showNewMessages) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setFadeOut(true);
      setTimeout(() => {
        setShowNewMessages(false);
        setNewMsgCount(0);
      }, 500);
    }, 5000);
    return () => hideTimerRef.current && clearTimeout(hideTimerRef.current);
  }, [showNewMessages]);

  const handleScroll = (e) => {
    const el = e.target;
    const isNear = el.scrollHeight - el.scrollTop <= el.clientHeight + 50;
    if (isNear) {
      setShowNewMessages(false);
      setNewMsgCount(0);
      hideTimerRef.current && clearTimeout(hideTimerRef.current);
      if (username && room) socket.emit("markAsRead", { username, room });
    }
  };

  // typing
  const handleTyping = (e) => {
    const v = e.target.value;
    setText(v);
    if (!username || !room) return;
    socket.emit("typing", { username, room });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => socket.emit("stopTyping", { room }), 900);
  };

  // send
  const sendMessage = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !username || !room) return;
    socket.emit("sendMessage", { username, text: t, room });
    setText("");
    setShowEmoji(false);
    socket.emit("stopTyping", { room });
    setTimeout(() => scrollToBottom(), 35);
  };

  // emoji
  const onEmojiClick = (emojiData) => {
    setText((prev) => prev + (emojiData?.emoji || ""));
  };

  // --- Screens ---
  if (!username) {
    return (
      <div className="app">
        <div className="login">
          <h2>{mode === "login" ? "Login" : "Signup"}</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();

              const formData = new FormData();
              formData.append("username", form.username);
              formData.append("email", form.email);
              formData.append("password", form.password);
              if (form.avatar) formData.append("avatar", form.avatar);

              try {
                const url = `${SERVER_URL}/${mode}`;
                const res = await axios.post(url, formData, {
                  headers: { "Content-Type": "multipart/form-data" },
                });
                setUsername(res.data.username);
                setToken(res.data.token);
                localStorage.setItem("chatUser", res.data.username);
                localStorage.setItem("chatToken", res.data.token);
                localStorage.setItem("chatAvatar", res.data.avatar || "");
                socket.emit("joinRoom", { username: res.data.username });
              } catch (err) {
                alert(err.response?.data?.error || "Auth failed");
              }
            }}
          >
            <input
              type="text"
              placeholder="Username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
            {mode === "signup" && (
              <>
                <input
                  type="email"
                  placeholder="Email"
                  value={form.email || ""}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />

                {/* 🆕 Avatar upload field */}
                <label style={{ display: "block", marginTop: "10px" }}>
                  Choose avatar:
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      setForm({ ...form, avatar: e.target.files?.[0] || null })
                    }
                  />
                </label>

                {/* 🆕 Avatar preview */}
                {form.avatar && (
                  <img
                    src={URL.createObjectURL(form.avatar)}
                    alt="Preview"
                    style={{
                      width: "80px",
                      height: "80px",
                      borderRadius: "50%",
                      marginTop: "10px",
                      objectFit: "cover",
                      border: "2px solid var(--border)",
                    }}
                  />
                )}
              </>
            )}
            <input
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <button type="submit">{mode === "login" ? "Login" : "Signup"}</button>
          </form>
          <p>
            {mode === "login" ? "Don't have an account?" : "Already registered?"}{" "}
            <button className="link" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
              {mode === "login" ? "Signup" : "Login"}
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="app">
        <div className="login" style={{ width: 420 }}>
          <h2>Choose a Room</h2>
          <div style={{ textAlign: "left", marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 6 }}>Join existing:</label>
            <div className="room-list">
              {rooms.length ? (
                rooms.map((r) => (
                  <button key={r} className="room-badge" onClick={() => joinRoom(r)}>
                    #{r}
                  </button>
                ))
              ) : (
                <div className="muted">No rooms yet — create one below</div>
              )}
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              joinRoom(newRoom);
            }}
          >
            <input
              type="text"
              placeholder="Create or join room (e.g., tech-talk)"
              value={newRoom}
              onChange={(e) => setNewRoom(e.target.value)}
            />
            <button type="submit">Enter</button>
          </form>
          <p style={{ marginTop: 12, fontSize: "0.9em" }}>
            Logged in as <strong>{username}</strong>
          </p>
          <div style={{ marginTop: 8 }}>
            <button className="link" onClick={toggleDarkMode}>
              {darkMode ? "☀️ Light theme" : "🌙 Dark theme"}
            </button>
            <span style={{ margin: "0 8px" }}>•</span>
            <button className="link" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Chat screen
  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>#{room}</h2>
        <div>
          <button className="toggle-dark" onClick={toggleDarkMode}>
            {darkMode ? "☀️ Light" : "🌙 Dark"}
          </button>
          <button className="logout" onClick={handleLogout}>Logout</button>
        </div>
      </div>

      <div className="chat-main">
        <aside className="sidebar">
          <h4>Online in #{room}</h4>
          <ul>{onlineUsers.map((u, i) => <li key={i}>{u}</li>)}</ul>
          {typingUser && <p className="typing">{typingUser} is typing…</p>}
          <div style={{ marginTop: 12 }}>
            <button className="link" onClick={() => { setRoom(null); localStorage.removeItem("chatRoom"); setMessages([]); }}>
              ← Switch room
            </button>
          </div>
        </aside>

        <section className="messages-area">
          <div className="messages" onScroll={handleScroll}>
            {messages.map((m, i) => {
              const mine = m.username === username;
              const readers = (m.readBy || []).filter((u) => u !== m.username);
              return (
                <div key={m._id || i} className={`message ${mine ? "me" : "other"}`}>
                  <div className="text">
                    {!mine && <strong>{m.username}: </strong>}
                    {m.text}
                    <span className="timestamp">
                      {formatTimestamp(m.createdAt)}
                      {mine && (readers.length > 0 ? <DoubleCheck /> : <SingleCheck />)}
                    </span>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {showNewMessages && (
            <div
              className={`newMessages ${fadeOut ? "hide" : ""}`}
              onClick={() => {
                scrollToBottom();
                setShowNewMessages(false);
                setNewMsgCount(0);
                hideTimerRef.current && clearTimeout(hideTimerRef.current);
              }}
            >
              {newMsgCount > 1 ? `${newMsgCount} New Messages ↓` : "New Message ↓"}
            </div>
          )}

          <form className="composer" onSubmit={sendMessage}>
            <div className="emoji-wrap">
              <button
                type="button"
                className="emoji-btn"
                onClick={() => setShowEmoji((s) => !s)}
                aria-label="Emoji"
                title="Emoji"
              >
                😊
              </button>
              {showEmoji && (
                <div className="emoji-popover" onMouseDown={(e) => e.preventDefault()}>
                  <EmojiPicker onEmojiClick={(emojiData) => onEmojiClick(emojiData)} />
                </div>
              )}
            </div>

            <textarea value={text} onChange={handleTyping} placeholder={`Message #${room}…`} />
            <button type="submit">Send</button>
          </form>
        </section>
      </div>
    </div>
  );
}







