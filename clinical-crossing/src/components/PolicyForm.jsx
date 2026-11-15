// PolicyForm.jsx
// Three text boxes where the player writes their own policy ideas.
// There is deliberately no menu of options: the player has to think them up.

import { MAX_POLICY_CHARS } from '../ai/validate.js'

// policies: array of 3 strings (controlled by App)
// busy:     true while we wait for the interpreter
export default function PolicyForm({ policies, onChange, onSubmit, busy }) {
  const allFilled = policies.every((text) => text.trim().length > 0)

  function setPolicy(index, text) {
    const next = [...policies]
    next[index] = text
    onChange(next)
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (allFilled && !busy) onSubmit()
  }

  return (
    <form className="policy-form" onSubmit={handleSubmit}>
      {policies.map((text, index) => {
        const id = `policy-${index}`
        return (
          <div key={id} className="policy-field">
            <label htmlFor={id} className="policy-label">
              Change {index + 1}
            </label>
            <textarea
              id={id}
              className="policy-input"
              rows={2}
              maxLength={MAX_POLICY_CHARS}
              value={text}
              disabled={busy}
              placeholder={index === 0 ? 'Describe it in your own words…' : ''}
              onChange={(e) => setPolicy(index, e.target.value)}
            />
            <span className="policy-count" aria-live="off">
              {text.length}/{MAX_POLICY_CHARS}
            </span>
          </div>
        )
      })}

      <p className="privacy-note">
        Your text is sent to Google&apos;s Gemini API. Don&apos;t enter personal information. We don&apos;t save
        anything you type.
      </p>

      <button type="submit" className="submit-button" disabled={!allFilled || busy}>
        {busy ? 'Reading your ideas…' : 'See what happens'}
      </button>
    </form>
  )
}
