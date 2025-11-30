import React, { useEffect, useState, useRef } from 'react'
import './App.css'

export default function App() {
  const [sessionId, setSessionId] = useState(null)
  const [model, setModel] = useState('llama3')
  const [text, setText] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const chatRef = useRef(null)

  // Session setup fields
  const [learningLanguage, setLearningLanguage] = useState('Spanish')
  const [nativeLanguage, setNativeLanguage] = useState('English')
  const [situation, setSituation] = useState('')
  const [sessionStarted, setSessionStarted] = useState(false)

  async function startSession() {
    if (!learningLanguage || !nativeLanguage || !situation.trim()) {
      alert('Please fill in all fields')
      return
    }
    const resp = await fetch('/api/session', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ 
        learning_language: learningLanguage, 
        native_language: nativeLanguage, 
        situation: situation 
      }) 
    })
    const data = await resp.json()
    setSessionId(data.session_id)
    setSessionStarted(true)
  }

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages])

  async function send() {
    if (!text.trim() || loading) return
    if (!sessionId) return alert('no session yet')

    const userMessage = text.trim()
    setText('')
    setLoading(true)

    // Add user's message locally
    setMessages(prev => [...prev, { role: 'user', text: userMessage }])

    // Prepare message object for assistant response
    const assistantMessage = {
      role: 'assistant',
      reply: '',
      translation: '',
      feedback: '',
      status: 'loading'
    }
    setMessages(prev => [...prev, assistantMessage])

    try {
      const resp = await fetch('/api/message', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ session_id: sessionId, text: userMessage, model }) 
      })

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const data = JSON.parse(line)
            
            if (data.type === 'reply') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1].reply = data.text
                return updated
              })
            } else if (data.type === 'translation') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1].translation = data.text
                return updated
              })
            } else if (data.type === 'feedback') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1].feedback = data.text
                return updated
              })
            } else if (data.type === 'done') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1].status = 'done'
                return updated
              })
            } else if (data.type === 'error') {
              console.error('Stream error:', data.message)
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1].status = 'error'
                updated[updated.length - 1].error = data.message
                return updated
              })
            }
          } catch (e) {
            console.warn('Failed to parse line:', line, e)
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer)
          if (data.type === 'reply') {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1].reply = data.text
              return updated
            })
          }
        } catch (e) { }
      }

    } catch (err) {
      console.error('Failed to send message:', err)
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1].status = 'error'
        updated[updated.length - 1].error = 'Failed to send message'
        return updated
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto' }}>
      <h2>Language Roleplay — Minimal client</h2>

      {!sessionStarted ? (
        <div style={{ marginBottom: 20 }}>
          <h3>Start a new session</h3>
          <div style={{ marginBottom: 12 }}>
            <label>Language you're learning: <input value={learningLanguage} onChange={e => setLearningLanguage(e.target.value)} placeholder="e.g. Spanish" /></label>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Your native language: <input value={nativeLanguage} onChange={e => setNativeLanguage(e.target.value)} placeholder="e.g. English" /></label>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Describe the situation:</label>
            <textarea value={situation} onChange={e => setSituation(e.target.value)} placeholder="e.g. Ordering food at a restaurant" style={{ width: '100%', height: 80, padding: 8 }} />
          </div>
          <button onClick={startSession}>Start Roleplay</button>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <label>Model: <input value={model} onChange={e => setModel(e.target.value)} /></label>
          </div>

          <div id="chat" ref={chatRef} style={{ border: '1px solid #ddd', height: 360, padding: 12, overflowY: 'auto', background: '#fafafa', marginBottom: 12 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ margin: '12px 0' }}>
                {m.role === 'user' ? (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-block', padding: '8px 12px', borderRadius: 6, background: '#646cff', color: 'white' }}>{m.text}</div>
                  </div>
                ) : (
                  <div style={{ background: '#f0f0f0', padding: 12, borderRadius: 6 }}>
                    {m.reply && (
                      <div style={{ marginBottom: 8, padding: 8, background: '#e8f4f8', borderLeft: '3px solid #2196F3', borderRadius: 4 }}>
                        <strong style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: '#1976D2' }}>Reply:</strong>
                        <div>{m.reply}</div>
                      </div>
                    )}
                    {m.translation && (
                      <div style={{ marginBottom: 8, padding: 8, background: '#f0f8e8', borderLeft: '3px solid #4CAF50', borderRadius: 4 }}>
                        <strong style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: '#388E3C' }}>Translation:</strong>
                        <div>{m.translation}</div>
                      </div>
                    )}
                    {m.feedback && (
                      <div style={{ padding: 8, background: '#fff8e1', borderLeft: '3px solid #FF9800', borderRadius: 4 }}>
                        <strong style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: '#F57C00' }}>Feedback:</strong>
                        <div>{m.feedback}</div>
                      </div>
                    )}
                    {m.status === 'loading' && !m.reply && (
                      <div style={{ fontStyle: 'italic', color: '#666' }}>Generating response...</div>
                    )}
                    {m.status === 'error' && (
                      <div style={{ color: '#d32f2f' }}>Error: {m.error}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Type and press Enter" disabled={loading} style={{ flex: 1, padding: 8 }} />
            <button onClick={send} disabled={loading} style={{ padding: '8px 16px', cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Sending...' : 'Send'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
