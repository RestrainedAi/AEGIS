import type { CSSProperties } from 'react'
import AuthControls from './AuthControls'

export default function LoginPage() {
  return (
    <div style={pageStyle}>
      <div style={glowTopStyle} />
      <div style={glowBottomStyle} />
      <main style={mainStyle}>
        <div style={panelStyle}>
          <AuthControls variant="login" />
        </div>
      </main>
    </div>
  )
}

const pageStyle: CSSProperties = {
  minHeight: '100svh',
  background:
    'radial-gradient(circle at 18% 12%, rgba(0, 227, 253, 0.12), transparent 26%), radial-gradient(circle at 84% 84%, rgba(113, 94, 247, 0.16), transparent 28%), linear-gradient(180deg, #040507 0%, #080b12 100%)',
  position: 'relative',
  overflow: 'hidden',
}

const mainStyle: CSSProperties = {
  minHeight: '100svh',
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  position: 'relative',
  zIndex: 1,
}

const panelStyle: CSSProperties = {
  width: 'min(100%, 420px)',
  padding: 24,
  borderRadius: 28,
  background: 'rgba(7, 10, 16, 0.72)',
  border: '1px solid rgba(129, 236, 255, 0.14)',
  boxShadow: '0 32px 90px rgba(0, 0, 0, 0.42)',
  backdropFilter: 'blur(22px)',
}

const glowTopStyle: CSSProperties = {
  position: 'absolute',
  top: '-10%',
  left: '-6%',
  width: 420,
  height: 420,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(0, 227, 253, 0.2) 0%, transparent 66%)',
  filter: 'blur(30px)',
  pointerEvents: 'none',
}

const glowBottomStyle: CSSProperties = {
  position: 'absolute',
  right: '-8%',
  bottom: '-12%',
  width: 460,
  height: 460,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(113, 94, 247, 0.22) 0%, transparent 68%)',
  filter: 'blur(34px)',
  pointerEvents: 'none',
}
