import React, { useEffect, useState, useRef } from 'react'

export default function App() {
  const [sessionId, setSessionId] = useState(null)
  const [model, setModel] = useState('llama3')
  const [text, setText] = useState('')
  const [messages, setMessages] = useState([])
  const chatRef = useRef(null)

  useEffect(() => {
    // Create a session on load
    fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'spanish' }) })
      .then(r => r.json())
      .then(d => setSessionId(d.session_id))
  }, [])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages])

  async function send() {
    if (!text.trim()) return
    if (!sessionId) return alert('no session yet')

    // Add user's message locally
    setMessages(prev => [...prev, { role: 'user', text }])
    const payload = { session_id: sessionId, text, model }

    try {
      const resp = await fetch('/api/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

      // Stream the response (server proxies Ollama streaming JSON lines)
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantText = ''

      // Add empty assistant message to update progressively
      setMessages(prev => [...prev, { role: 'assistant', text: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const j = JSON.parse(line)
            assistantText += j.response || ''
            // Replace last assistant message with new text
            setMessages(prev => {
              const copy = [...prev]
              for (let i = copy.length - 1; i >= 0; i--) {
                if (copy[i].role === 'assistant') { copy[i] = { role: 'assistant', text: assistantText }; break }
              }
              return copy
            })
          } catch (e) { /* ignored */ }
        }
      }

      // final buffer
      if (buffer.trim()) {
        try {
          const j = JSON.parse(buffer)
          assistantText += j.response || ''
          setMessages(prev => {
            const copy = [...prev]
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === 'assistant') { copy[i] = { role: 'assistant', text: assistantText }; break }
            }
            return copy
          })
        } catch (e) { }
      }

      // Append assistant final message to session on server-side if needed (not implemented here)

    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Network error: ' + err }])
    }

    setText('')
  }

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto' }}>
      <h2>Language Roleplay — Minimal client</h2>
      <div style={{ marginBottom: 12 }}>
        <label>Model: <input value={model} onChange={e => setModel(e.target.value)} /></label>
      </div>

      <div id="chat" ref={chatRef} style={{ border: '1px solid #ddd', height: 360, padding: 12, overflowY: 'auto', background: '#fafafa', marginBottom: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ textAlign: m.role === 'user' ? 'right' : 'left', margin: '6px 0' }}>
            <div style={{ display: 'inline-block', padding: '8px 10px', borderRadius: 6, background: m.role === 'user' ? '#e3f2fd' : '#fff' }}>{m.text}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Type and press Enter" />
        <button onClick={send}>Send</button>
      </div>
    </div>
  )
}
