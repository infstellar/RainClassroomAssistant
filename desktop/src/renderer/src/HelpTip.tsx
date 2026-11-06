import { useId, useState } from 'react'
import { CircleHelp } from 'lucide-react'

export function HelpTip({
  label,
  children,
}: {
  label: string
  children: string
}) {
  const id = useId()
  const [dismissed, setDismissed] = useState(false)
  return (
    <span className={`help-tip ${dismissed ? 'dismissed' : ''}`}>
      <span
        role="button"
        tabIndex={0}
        className="help-tip-trigger"
        aria-label={`${label}说明`}
        aria-describedby={id}
        onMouseEnter={() => setDismissed(false)}
        onFocus={() => setDismissed(false)}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setDismissed(false)
        }}
        onKeyDown={(event) => {
          if (['Escape', 'Enter', ' '].includes(event.key)) {
            event.preventDefault()
            event.stopPropagation()
            setDismissed(event.key === 'Escape')
          }
        }}
      >
        <CircleHelp size={18} aria-hidden="true" />
      </span>
      <span id={id} role="tooltip" className="help-tip-content">
        {children}
      </span>
    </span>
  )
}
