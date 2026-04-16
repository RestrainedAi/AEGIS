import type { CSSProperties } from 'react'
import AuthControls from './AuthControls'
import { signupCatalogById } from '../lib/signupCatalog'
import { useMediaQuery } from '../lib/useMediaQuery'

const SUPPORT_EMAIL = 'blahnikdigitaldesigns@gmail.com'

const futureVectors = [
  {
    id: 'creator_monthly',
    lane: 'TARGET 01',
    title: 'Creator Monthly',
    price: '$29 / mo',
    summary: 'Enhanced throughput and priority node allocation once the beta concludes.',
    accent: '#00e3fd',
  },
  {
    id: 'studio_monthly',
    lane: 'TARGET 02',
    title: 'Studio Monthly',
    price: '$99 / mo',
    summary: 'Multi-seat licensing and higher-fidelity extensions for teams.',
    accent: '#cdbdff',
  },
]

const accessSteps = [
  {
    id: '01',
    title: 'Secure sign-in',
    body: 'Authenticate with Google so we can anchor your beta request to one verified identity.',
  },
  {
    id: '02',
    title: 'Intent review',
    body: 'Tell us how you plan to use sundrop and which creative lane fits your workflow.',
  },
  {
    id: '03',
    title: 'Manual provisioning',
    body: 'Our architects review requests within 48 hours and send the result through secure mail.',
  },
]

export default function SignupPage() {
  const isCompact = useMediaQuery('(max-width: 980px)')
  const betaTier = signupCatalogById.beta
  const creatorTier = signupCatalogById.creator_monthly
  const studioTier = signupCatalogById.studio_monthly

  return (
    <div style={pageStyle}>
      <div style={topGlowStyle} />
      <div style={bottomGlowStyle} />

      <header style={headerStyle}>
        <div style={headerInnerStyle(isCompact)}>
          <div style={brandGroupStyle}>
            <a href="/" style={brandStyle}>
              sundrop
            </a>
            <div style={brandDividerStyle} />
            <span style={brandKickerStyle}>Sovereign onboarding</span>
          </div>

          <nav style={navStyle} aria-label="Primary">
            <a href="#manifesto" style={navLinkStyle}>
              Manifesto
            </a>
            <a href="#infrastructure" style={navLinkStyle}>
              Infrastructure
            </a>
            <a href="#request" style={navLinkActiveStyle}>
              Beta Portal
            </a>
            <span style={iconClusterStyle}>
              <span className="material-symbols-outlined" aria-hidden="true">
                lock
              </span>
              <span className="material-symbols-outlined" aria-hidden="true">
                settings
              </span>
            </span>
          </nav>
        </div>
      </header>

      <main style={mainStyle}>
        <section id="manifesto" style={heroStyle}>
          <p style={heroEyebrowStyle}>Phase zero deployment</p>
          <h1 style={heroTitleStyle}>
            Public beta is <span style={heroAccentStyle}>approval-based</span>, with a clear
            migration path later.
          </h1>
          <p style={heroLeadStyle}>
            We are curating a select cohort of visionaries to stress-test the Sovereign Shell.
            Entry is manually reviewed to keep the cloud side calm and the harvest side separate.
          </p>
        </section>

        <section id="infrastructure" style={contentGridStyle(isCompact)}>
          <div style={leftRailStyle}>
            <article style={panelStyle}>
              <div style={panelTopRowStyle}>
                <div>
                  <p style={panelKickerStyle}>Platform lane</p>
                  <h2 style={panelTitleStyle}>Beta Tester Tier</h2>
                </div>
                <div style={statusBadgeStyle}>Current offering</div>
              </div>

              <div style={featureGridStyle}>
                <ul style={bulletListStyle}>
                  <li style={bulletItemStyle}>
                    <span style={bulletDotStyle} />
                    <span>
                      Cost: <strong>$0.00</strong> during beta
                    </span>
                  </li>
                  <li style={bulletItemStyle}>
                    <span style={bulletDotStyle} />
                    <span>Full vault access</span>
                  </li>
                </ul>
                <ul style={bulletListStyle}>
                  <li style={bulletItemStyle}>
                    <span style={bulletDotStyle} />
                    <span>Feedback-driven shaping</span>
                  </li>
                  <li style={bulletItemStyle}>
                    <span style={bulletDotStyle} />
                    <span>Manual approval required</span>
                  </li>
                </ul>
              </div>
            </article>

            <section style={sectionBlockStyle}>
              <div style={sectionHeadingRowStyle}>
                <h2 style={sectionHeadingStyle}>Future vectors</h2>
                <div style={sectionDividerStyle} />
              </div>

              <div style={futureVectorGridStyle}>
                {futureVectors.map((vector) => (
                  <article key={vector.id} style={futureVectorCardStyle(vector.accent)}>
                    <p style={futureVectorLaneStyle}>{vector.lane}</p>
                    <div style={futureVectorTitleRowStyle}>
                      <h3 style={futureVectorTitleStyle}>{vector.title}</h3>
                      <span style={futureVectorPriceStyle}>{vector.price}</span>
                    </div>
                    <p style={futureVectorBodyStyle}>{vector.summary}</p>
                  </article>
                ))}
              </div>
            </section>

            <section style={sectionBlockStyle}>
              <h2 style={sectionHeadingStyle}>System entry protocol</h2>
              <div style={stepsListStyle}>
                {accessSteps.map((step) => (
                  <article key={step.id} style={stepRowStyle}>
                    <div style={stepNumberStyle}>{step.id}</div>
                    <div style={stepBodyStyle}>
                      <h3 style={stepTitleStyle}>{step.title}</h3>
                      <p style={stepTextStyle}>{step.body}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section style={supportGridStyle}>
              <article style={supportCardStyle}>
                <p style={supportKickerStyle}>What stays separate</p>
                <p style={supportBodyStyle}>
                  Beta data streams remain isolated from production shards so migration stays clean
                  when public release opens.
                </p>
              </article>
              <article style={supportCardStyle}>
                <p style={supportKickerStyle}>Need assistance?</p>
                <p style={supportBodyStyle}>
                  Contact{' '}
                  <a href={`mailto:${SUPPORT_EMAIL}`} style={inlineLinkStyle}>
                    {SUPPORT_EMAIL}
                  </a>{' '}
                  if you need account help or want to discuss access.
                </p>
              </article>
            </section>
          </div>

          <aside id="request" style={rightRailStyle(isCompact)}>
            <AuthControls variant="signup" preferredTierId="beta" />
          </aside>
        </section>

        <section style={footerNoteStyle}>
          <div style={footerNoteLineStyle}>
            <span>sundrop handles access and publishing.</span>
            <span>sundrop music handles harvest and source tools.</span>
            <span>The vault stays separate.</span>
          </div>
          <div style={footerMetaStyle}>
            <span>{betaTier.summary}</span>
            <span>
              {creatorTier.label}: {creatorTier.priceLabel}
            </span>
            <span>
              {studioTier.label}: {studioTier.priceLabel}
            </span>
          </div>
        </section>
      </main>
    </div>
  )
}

const pageStyle: CSSProperties = {
  minHeight: '100svh',
  position: 'relative',
  overflow: 'hidden',
  background:
    'radial-gradient(circle at 18% 0%, rgba(0, 227, 253, 0.08), transparent 26%), radial-gradient(circle at 100% 14%, rgba(205, 189, 255, 0.05), transparent 20%), linear-gradient(180deg, #050506 0%, #09090c 42%, #040405 100%)',
  color: '#e7e5e7',
  fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
}

const topGlowStyle: CSSProperties = {
  position: 'absolute',
  inset: '-8rem auto auto 10%',
  width: 460,
  height: 460,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(0, 227, 253, 0.12) 0%, transparent 68%)',
  filter: 'blur(28px)',
  pointerEvents: 'none',
}

const bottomGlowStyle: CSSProperties = {
  position: 'absolute',
  right: '-8%',
  bottom: '-8rem',
  width: 640,
  height: 640,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(255, 113, 108, 0.1) 0%, transparent 64%)',
  filter: 'blur(34px)',
  pointerEvents: 'none',
}

const headerStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 30,
  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
  background: 'rgba(5, 5, 6, 0.72)',
  backdropFilter: 'blur(18px)',
}

const headerInnerStyle = (isCompact: boolean): CSSProperties => ({
  maxWidth: 1440,
  margin: '0 auto',
  padding: isCompact ? '16px 18px' : '18px clamp(18px, 2vw, 28px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
})

const brandGroupStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
}

const brandStyle: CSSProperties = {
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontSize: 28,
  lineHeight: 1,
  textDecoration: 'none',
  letterSpacing: '-0.04em',
}

const brandDividerStyle: CSSProperties = {
  width: 42,
  height: 1,
  background: 'rgba(255, 255, 255, 0.18)',
}

const brandKickerStyle: CSSProperties = {
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.38em',
}

const navStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
}

const navLinkStyle: CSSProperties = {
  color: 'rgba(231, 229, 231, 0.7)',
  textDecoration: 'none',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.26em',
}

const navLinkActiveStyle: CSSProperties = {
  ...navLinkStyle,
  color: '#81ecff',
  fontWeight: 700,
}

const iconClusterStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 12,
  color: '#00e3fd',
  fontSize: 24,
}

const mainStyle: CSSProperties = {
  maxWidth: 1440,
  margin: '0 auto',
  padding: '30px clamp(18px, 2vw, 28px) 56px',
  display: 'grid',
  gap: 28,
  position: 'relative',
  zIndex: 1,
}

const heroStyle: CSSProperties = {
  textAlign: 'center',
  display: 'grid',
  justifyItems: 'center',
  gap: 18,
  padding: '28px 0 12px',
}

const heroEyebrowStyle: CSSProperties = {
  margin: 0,
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  textTransform: 'uppercase',
  letterSpacing: '0.46em',
  fontSize: 10,
}

const heroTitleStyle: CSSProperties = {
  margin: 0,
  maxWidth: 1140,
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 'clamp(3.1rem, 6vw, 6.1rem)',
  lineHeight: 0.96,
  letterSpacing: '-0.04em',
}

const heroAccentStyle: CSSProperties = {
  color: '#00e3fd',
}

const heroLeadStyle: CSSProperties = {
  margin: 0,
  maxWidth: 760,
  color: 'rgba(231, 229, 231, 0.72)',
  fontSize: 'clamp(1rem, 1.2vw, 1.12rem)',
  lineHeight: 1.78,
}

const contentGridStyle = (isCompact: boolean): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: isCompact ? '1fr' : 'minmax(0, 1.3fr) minmax(360px, 0.92fr)',
  gap: 24,
  alignItems: 'start',
})

const leftRailStyle: CSSProperties = {
  display: 'grid',
  gap: 18,
}

const panelStyle: CSSProperties = {
  background: 'rgba(14, 14, 17, 0.9)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  boxShadow: '0 22px 56px rgba(0, 0, 0, 0.32)',
  padding: 28,
}

const panelTopRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  marginBottom: 20,
}

const panelKickerStyle: CSSProperties = {
  margin: '0 0 8px',
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.34em',
}

const panelTitleStyle: CSSProperties = {
  margin: 0,
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontSize: 'clamp(2rem, 2.7vw, 3rem)',
  lineHeight: 1,
}

const statusBadgeStyle: CSSProperties = {
  border: '1px solid rgba(255, 255, 255, 0.08)',
  padding: '10px 14px',
  color: '#ffbd5c',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.24em',
  whiteSpace: 'nowrap',
}

const featureGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 18,
}

const bulletListStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'grid',
  gap: 16,
}

const bulletItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  color: '#e7e5e7',
  lineHeight: 1.6,
  fontSize: 15,
}

const bulletDotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  marginTop: 6,
  background: '#81ecff',
  boxShadow: '0 0 0 4px rgba(129, 236, 255, 0.08)',
  flex: '0 0 auto',
}

const sectionBlockStyle: CSSProperties = {
  display: 'grid',
  gap: 16,
}

const sectionHeadingRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
}

const sectionHeadingStyle: CSSProperties = {
  margin: 0,
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontSize: 'clamp(1.8rem, 2.5vw, 2.8rem)',
  lineHeight: 1,
}

const sectionDividerStyle: CSSProperties = {
  height: 1,
  flex: 1,
  background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.18) 0%, transparent 100%)',
}

const futureVectorGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 0,
  border: '1px solid rgba(255, 255, 255, 0.06)',
  background: 'rgba(255, 255, 255, 0.06)',
}

const futureVectorCardStyle = (accent: string): CSSProperties => ({
  minHeight: 206,
  background: 'rgba(13, 13, 16, 0.95)',
  padding: 22,
  borderRight: '1px solid rgba(255, 255, 255, 0.06)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
  display: 'grid',
  alignContent: 'start',
  gap: 14,
  boxShadow: `inset 0 2px 0 ${accent}20`,
})

const futureVectorLaneStyle: CSSProperties = {
  margin: 0,
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.3em',
}

const futureVectorTitleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 14,
}

const futureVectorTitleStyle: CSSProperties = {
  margin: 0,
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 24,
  lineHeight: 1.06,
}

const futureVectorPriceStyle: CSSProperties = {
  color: '#cdbdff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.22em',
  whiteSpace: 'nowrap',
}

const futureVectorBodyStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.7)',
  lineHeight: 1.72,
  fontSize: 14,
}

const stepsListStyle: CSSProperties = {
  display: 'grid',
  gap: 18,
}

const stepRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: 18,
  alignItems: 'start',
}

const stepNumberStyle: CSSProperties = {
  color: 'rgba(231, 229, 231, 0.38)',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 32,
  lineHeight: 1,
}

const stepBodyStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
}

const stepTitleStyle: CSSProperties = {
  margin: 0,
  color: '#ffffff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  textTransform: 'uppercase',
  letterSpacing: '0.22em',
  fontSize: 12,
}

const stepTextStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.72)',
  lineHeight: 1.7,
  fontSize: 14,
}

const supportGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 16,
}

const supportCardStyle: CSSProperties = {
  padding: 20,
  border: '1px solid rgba(255, 255, 255, 0.06)',
  background: 'rgba(11, 11, 14, 0.86)',
  display: 'grid',
  gap: 10,
}

const supportKickerStyle: CSSProperties = {
  margin: 0,
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.3em',
}

const supportBodyStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.68)',
  lineHeight: 1.7,
  fontSize: 14,
}

const inlineLinkStyle: CSSProperties = {
  color: '#81ecff',
  textDecoration: 'none',
  fontWeight: 600,
}

const rightRailStyle = (isCompact: boolean): CSSProperties => ({
  position: isCompact ? 'static' : 'sticky',
  top: isCompact ? 'auto' : 92,
  display: 'grid',
  alignSelf: 'start',
})

const footerNoteStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  paddingTop: 8,
}

const footerNoteLineStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  justifyContent: 'space-between',
  color: 'rgba(231, 229, 231, 0.42)',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.24em',
}

const footerMetaStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  color: 'rgba(231, 229, 231, 0.55)',
  fontSize: 13,
}
