import { useEffect, type CSSProperties, type ReactNode } from 'react'
import AdminControlCenter from './components/AdminControlCenter'
import AuthControls from './components/AuthControls'
import LoginPage from './components/LoginPage'
import SignupPage from './components/SignupPage'
import VaultGrid from './components/VaultGrid'
import { useMediaQuery } from './lib/useMediaQuery'
const APP_NAME = 'sundrop'
const SUPPORT_EMAIL = 'blahnikdigitaldesigns@gmail.com'
const GLOBAL_SCROLLBAR_STYLE_ID = 'sundrop-global-scrollbars'

function useGlobalScrollbarStyles() {
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (document.getElementById(GLOBAL_SCROLLBAR_STYLE_ID)) return

    const style = document.createElement('style')
    style.id = GLOBAL_SCROLLBAR_STYLE_ID
    style.textContent = `
      html {
        scrollbar-width: auto;
        scrollbar-color: #8e63ff rgba(10, 13, 20, 0.92);
      }

      body::-webkit-scrollbar,
      *::-webkit-scrollbar {
        width: 16px;
        height: 16px;
      }

      body::-webkit-scrollbar-track,
      *::-webkit-scrollbar-track {
        background: rgba(10, 13, 20, 0.92);
      }

      body::-webkit-scrollbar-thumb,
      *::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, #b18cff 0%, #8e63ff 52%, #6c44f5 100%);
        border: 3px solid rgba(10, 13, 20, 0.92);
        border-radius: 999px;
        min-height: 48px;
      }

      body::-webkit-scrollbar-thumb:hover,
      *::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(180deg, #c7a8ff 0%, #9d78ff 52%, #7a54ff 100%);
      }

      body::-webkit-scrollbar-corner,
      *::-webkit-scrollbar-corner {
        background: rgba(10, 13, 20, 0.92);
      }
    `
    document.head.appendChild(style)

    return () => {
      style.remove()
    }
  }, [])
}

function pageShell(title: string, content: ReactNode, eyebrow = 'sundrop cloud') {
  return (
    <div style={shellStyle}>
      <header style={headerStyle}>
        <div style={headerTopStyle}>
          <div>
            <a href="/" style={brandStyle}>{APP_NAME}</a>
            <nav style={navStyle}>
              <a href="/vault" style={navLinkStyle}>Vault</a>
              <a href="/login" style={navLinkStyle}>Login</a>
              <a href="/signup" style={navLinkStyle}>Beta Signup</a>
              <a href="/control-center" style={navLinkStyle}>Control Center</a>
              <a href="/privacy" style={navLinkStyle}>Privacy</a>
              <a href="/terms" style={navLinkStyle}>Terms</a>
            </nav>
          </div>
          <AuthControls />
        </div>
      </header>

      <main style={mainStyle}>
        <section style={heroCardStyle}>
          <p style={eyebrowStyle}>{eyebrow}</p>
          <h1 style={titleStyle}>{title}</h1>
          {content}
        </section>
      </main>

      <footer style={footerStyle}>
        <div>
          <strong>{APP_NAME}</strong> keeps account access, Vault preservation, and publishing controls
          connected while sundrop music stays focused on music source, catalog, and delivery tools.
        </div>
        <div style={footerLinksStyle}>
          <a href="/privacy" style={footerLinkStyle}>Privacy Policy</a>
          <a href="/terms" style={footerLinkStyle}>Terms of Service</a>
          <a href={`mailto:${SUPPORT_EMAIL}`} style={footerLinkStyle}>{SUPPORT_EMAIL}</a>
        </div>
      </footer>
    </div>
  )
}

function HomePage() {
  useGlobalScrollbarStyles()
  const isCompact = useMediaQuery('(max-width: 920px)')
  const pulseStrip = [
    'CATALOG_SYNC: ACTIVE',
    'AUDIO_INDEX: CURRENT',
    'SOURCE_STREAM: SUNO + YOUTUBE',
    'API_LATENCY: 42MS',
    'VAULT_SECURITY: ENFORCED',
    'EXPORT_QUEUE: READY',
    'STATUS: HEALTHY',
  ]

  const harvestSignals = [
    'Suno source ingestion',
    'YouTube metadata indexing',
    'Catalog integrity validation',
  ]

  const vaultCards = [
    {
      label: '001 / CAPACITY',
      title: 'Scalable Library',
      body: 'Storage grows with your catalog so tracks, artwork, and lyrics stay organized as the library expands.',
      tone: 'primary',
    },
    {
      label: '002 / SECURITY',
      title: 'Access Control',
      body: 'Authentication, workspace controls, and package permissions keep account access aligned with the right team and catalog.',
      tone: 'secondary',
    },
    {
      label: '003 / RETRIEVAL',
      title: 'Fast Retrieval',
      body: 'Music files, manifests, and export packages stay available through a single retrieval surface in the Vault.',
      tone: 'tertiary',
    },
  ]

  const ascentCards = [
    {
      phase: 'PHASE_01',
      title: 'Source Intake',
      accent: '#00e3fd',
      bg: 'radial-gradient(circle at 30% 20%, rgba(0, 227, 253, 0.16), transparent 45%), linear-gradient(180deg, rgba(23, 32, 51, 0.3), rgba(0, 0, 0, 0.85))',
    },
    {
      phase: 'PHASE_02',
      title: 'Metadata Review',
      accent: '#cdbdff',
      bg: 'radial-gradient(circle at 50% 20%, rgba(205, 189, 255, 0.15), transparent 42%), linear-gradient(180deg, rgba(23, 32, 51, 0.24), rgba(0, 0, 0, 0.85))',
    },
    {
      phase: 'PHASE_03',
      title: 'Security Controls',
      accent: '#ffbd5c',
      bg: 'radial-gradient(circle at 40% 24%, rgba(255, 189, 92, 0.16), transparent 44%), linear-gradient(180deg, rgba(23, 32, 51, 0.22), rgba(0, 0, 0, 0.86))',
    },
    {
      phase: 'PHASE_04',
      title: 'Delivery Ready',
      accent: '#ff716c',
      bg: 'radial-gradient(circle at 50% 18%, rgba(255, 113, 108, 0.18), transparent 40%), linear-gradient(180deg, rgba(23, 32, 51, 0.22), rgba(0, 0, 0, 0.9))',
    },
  ]

  const landingHeaderInnerLayoutStyle: CSSProperties = {
    ...landingHeaderInnerStyle,
    padding: isCompact ? '14px 16px 12px' : landingHeaderInnerStyle.padding,
    flexDirection: isCompact ? 'column' : 'row',
    alignItems: 'center',
    justifyContent: isCompact ? 'center' : 'space-between',
    textAlign: isCompact ? 'center' : 'left',
  }

  const landingBrandRowLayoutStyle: CSSProperties = {
    ...landingBrandRowStyle,
    justifyContent: isCompact ? 'center' : 'flex-start',
  }

  const landingBrandDividerLayoutStyle: CSSProperties = {
    ...landingBrandDividerStyle,
    width: isCompact ? 30 : landingBrandDividerStyle.width,
  }

  const landingNavLayoutStyle: CSSProperties = {
    ...landingNavStyle,
    justifyContent: isCompact ? 'center' : 'flex-end',
    gap: isCompact ? 10 : 12,
  }

  const landingMainLayoutStyle: CSSProperties = {
    ...landingMainStyle,
    padding: isCompact ? '18px 14px 56px' : landingMainStyle.padding,
    gap: isCompact ? 18 : 28,
  }

  const landingHeroSectionLayoutStyle: CSSProperties = {
    ...landingHeroSectionStyle,
    gap: isCompact ? 16 : 24,
    gridTemplateColumns: isCompact ? '1fr' : landingHeroSectionStyle.gridTemplateColumns,
  }

  const landingHeroCopyLayoutStyle: CSSProperties = {
    ...landingHeroCopyStyle,
    minHeight: isCompact ? 'auto' : landingHeroCopyStyle.minHeight,
    padding: isCompact ? '26px 18px 22px' : landingHeroCopyStyle.padding,
  }

  const landingHeroTitleLayoutStyle: CSSProperties = {
    ...landingHeroTitleStyle,
    fontSize: isCompact ? 'clamp(2.6rem, 10vw, 4.4rem)' : landingHeroTitleStyle.fontSize,
    lineHeight: isCompact ? 0.96 : landingHeroTitleStyle.lineHeight,
  }

  const landingHeroLeadLayoutStyle: CSSProperties = {
    ...landingHeroLeadStyle,
    margin: isCompact ? '0 0 22px' : landingHeroLeadStyle.margin,
    fontSize: isCompact ? '1rem' : landingHeroLeadStyle.fontSize,
  }

  const landingHeroCtaRowLayoutStyle: CSSProperties = {
    ...landingHeroCtaRowStyle,
    flexDirection: isCompact ? 'column' : 'row',
    alignItems: isCompact ? 'stretch' : 'center',
  }

  const landingPrimaryButtonLayoutStyle: CSSProperties = {
    ...landingPrimaryButtonStyle,
    width: isCompact ? '100%' : 'auto',
  }

  const landingSecondaryButtonLayoutStyle: CSSProperties = {
    ...landingSecondaryButtonStyle,
    width: isCompact ? '100%' : 'auto',
  }

  const landingHeroStatCardLayoutStyle: CSSProperties = {
    ...landingHeroStatCardStyle,
    padding: isCompact ? 18 : 24,
  }

  const landingPulseStripLayoutStyle: CSSProperties = {
    ...landingPulseStripStyle,
    justifyContent: isCompact ? 'flex-start' : 'space-between',
    gap: isCompact ? 10 : 18,
  }

  const landingTwoColumnSectionLayoutStyle: CSSProperties = {
    ...landingTwoColumnSectionStyle,
    gap: isCompact ? 18 : 24,
    gridTemplateColumns: isCompact ? '1fr' : landingTwoColumnSectionStyle.gridTemplateColumns,
  }

  const landingVisualPanelLayoutStyle: CSSProperties = {
    ...landingVisualPanelStyle,
    minHeight: isCompact ? 360 : landingVisualPanelStyle.minHeight,
  }

  const landingCaptionCardLayoutStyle: CSSProperties = {
    ...landingCaptionCardStyle,
    right: isCompact ? 12 : 18,
    bottom: isCompact ? 12 : 18,
    padding: isCompact ? '14px 16px' : landingCaptionCardStyle.padding,
  }

  const landingSectionHeaderRowLayoutStyle: CSSProperties = {
    ...landingSectionHeaderRowStyle,
    gridTemplateColumns: isCompact ? '1fr' : landingSectionHeaderRowStyle.gridTemplateColumns,
  }

  const landingCtaSectionLayoutStyle: CSSProperties = {
    ...landingCtaSectionStyle,
    padding: isCompact ? '28px 14px 8px' : landingCtaSectionStyle.padding,
  }

  const landingCtaBodyLayoutStyle: CSSProperties = {
    ...landingCtaBodyStyle,
    fontSize: isCompact ? 16 : landingCtaBodyStyle.fontSize,
  }

  const landingPrimaryButtonLargeLayoutStyle: CSSProperties = {
    ...landingPrimaryButtonLargeStyle,
    width: isCompact ? '100%' : 'auto',
    minHeight: isCompact ? 50 : 54,
    padding: isCompact ? '0 22px' : landingPrimaryButtonLargeStyle.padding,
  }

  const landingFooterGridLayoutStyle: CSSProperties = {
    ...landingFooterGridStyle,
    gridTemplateColumns: isCompact ? '1fr' : landingFooterGridStyle.gridTemplateColumns,
    gap: isCompact ? 18 : 22,
    padding: isCompact ? '24px 16px 28px' : landingFooterGridStyle.padding,
  }

  const landingFooterBodyLayoutStyle: CSSProperties = {
    ...landingFooterBodyStyle,
    maxWidth: isCompact ? '100%' : landingFooterBodyStyle.maxWidth,
  }

  return (
    <div style={landingShellStyle}>
      <div style={landingGlowTopStyle} />
      <div style={landingGlowBottomStyle} />

      <header style={landingHeaderStyle}>
        <div style={landingHeaderInnerLayoutStyle}>
          <div style={landingBrandRowLayoutStyle}>
            <a href="/" style={landingBrandStyle}>sundrop</a>
            <div style={landingBrandDividerLayoutStyle} />
            <span style={landingSloganStyle}>Music catalog platform</span>
          </div>

          <nav style={landingNavLayoutStyle} aria-label="Primary">
            <a href="#harvest" style={landingNavLinkStyle}>Music Intake</a>
            <a href="#vault" style={landingNavLinkStyle}>The Vault</a>
            <a href="#intelligence" style={landingNavLinkStyle}>Security</a>
            <a href="/signup" style={landingNavButtonStyle}>Get Access</a>
          </nav>
        </div>
      </header>

      <main style={landingMainLayoutStyle}>
        <section style={landingHeroSectionLayoutStyle}>
          <div style={landingHeroCopyLayoutStyle}>
            <p style={landingEyebrowStyle}>Music catalog platform</p>
            <h1 style={landingHeroTitleLayoutStyle}>
              Music catalog management with <span style={landingHeroAccentStyle}>security-first storage</span>
            </h1>
            <p style={landingHeroLeadLayoutStyle}>
              sundrop brings Suno and YouTube music data into a controlled workspace for intake,
              indexing, storage, export packaging, and publishing operations.
            </p>
            <div style={landingHeroCtaRowLayoutStyle}>
              <a href="/signup" style={landingPrimaryButtonLayoutStyle}>Start Beta Signup</a>
              <a href="/login" style={landingSecondaryButtonLayoutStyle}>Login to Vault</a>
            </div>
          </div>

          <aside style={landingHeroStatCardLayoutStyle} aria-label="System readouts">
            <div style={landingHeroStatGroupStyle}>
              <p style={landingStatKickerStyle}>System uptime</p>
              <p style={landingStatValueStyle}>
                99.989% <span style={landingStatSuffixStyle}>available</span>
              </p>
            </div>
            <div style={landingStatDividerStyle} />
            <div style={landingHeroStatGroupStyle}>
              <p style={landingStatKickerStyle}>Catalog throughput</p>
              <p style={landingStatValueStyleAccent}>
                1.2M <span style={landingStatSuffixStyle}>rows indexed</span>
              </p>
            </div>
            <div style={landingHeroOrbStyle} />
          </aside>
        </section>

        <div style={landingPulseStripLayoutStyle} aria-label="Live system signals">
          {pulseStrip.map((item) => (
            <span key={item} style={landingPulseItemStyle}>{item}</span>
          ))}
        </div>

        <section id="harvest" style={landingTwoColumnSectionLayoutStyle}>
          <div style={landingVisualPanelLayoutStyle}>
            <div style={landingVisualArtifactStyle}>
              <div style={landingVisualRidgeStyle} />
              <div style={landingVisualRidgeAccentStyle} />
              <div style={landingVisualGlowStyle} />
            </div>
            <div style={landingCaptionCardLayoutStyle}>
              <p style={landingCaptionTitleStyle}>Catalog Intake</p>
              <p style={landingCaptionMetaStyle}>music_ingest_pipeline</p>
            </div>
          </div>

          <div style={landingCopyPanelStyle}>
            <p style={landingSectionEyebrowStyle}>Music Intake</p>
            <h2 style={landingSectionTitleStyle}>Built for music data, metadata, and file security.</h2>
            <p style={landingSectionBodyStyle}>
              Every song row, media asset, and source update is processed through a structured intake
              path so the catalog stays current, searchable, and ready for secure export and publishing.
            </p>
            <ul style={landingChecklistStyle}>
              {harvestSignals.map((item) => (
                <li key={item} style={landingChecklistItemStyle}>
                  <span style={landingChecklistDotStyle} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="vault" style={landingVaultSectionStyle}>
          <div style={landingSectionHeaderRowLayoutStyle}>
            <div style={landingSectionHeadingBlockStyle}>
              <p style={landingSectionEyebrowStyle}>The Vault</p>
              <h2 style={landingSectionTitleStyle}>Secure storage for music catalogs and delivery assets.</h2>
            </div>
            <p style={landingSectionSupportBodyStyle}>
              Catalog files, packaged downloads, and publishing controls stay inside a single
              authenticated environment with workspace-based access.
            </p>
          </div>

          <div style={landingVaultGridStyle}>
            {vaultCards.map((card) => (
              <article key={card.title} style={landingVaultCardStyle}>
                <p style={{ ...landingVaultLabelStyle, color: landingToneMap[card.tone] }}>{card.label}</p>
                <h3 style={landingVaultTitleStyle}>{card.title}</h3>
                <p style={landingVaultBodyStyle}>{card.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="intelligence" style={landingAscentSectionStyle}>
          <div style={landingAscentHeadingStyle}>
            <h2 style={landingAscentTitleStyle}>Operational visibility across music and security</h2>
            <p style={landingAscentSubtitleStyle}>Tracking the path from intake to secure delivery</p>
          </div>

          <div style={landingAscentGridStyle}>
            {ascentCards.map((card) => (
              <article key={card.title} style={{ ...landingAscentCardStyle, background: card.bg }}>
                <div style={landingAscentCardGlowStyle(card.accent)} />
                <p style={{ ...landingAscentPhaseStyle, color: card.accent }}>{card.phase}</p>
                <h3 style={landingAscentCardTitleStyle}>{card.title}</h3>
              </article>
            ))}
          </div>
        </section>

        <section style={landingCtaSectionLayoutStyle}>
          <h2 style={landingCtaTitleStyle}>
            Ready to manage your <span style={landingHeroAccentStyle}>music library?</span>
          </h2>
          <p style={landingCtaBodyLayoutStyle}>
            Sign in or request beta access to manage music sources, protect catalog assets, and
            prepare customer-ready packages from one secure workspace.
          </p>
          <a href="/signup" style={landingPrimaryButtonLargeLayoutStyle}>Start Beta Signup</a>
          <div style={landingProtocolRowStyle}>
            <span>Vault security: active</span>
            <span>Catalog intake: online</span>
            <span>Access policy: enforced</span>
          </div>
        </section>
      </main>

      <footer style={landingFooterStyle}>
        <div style={landingFooterGridLayoutStyle}>
          <div>
            <div style={landingFooterBrandRowStyle}>
              <span style={landingFooterBrandStyle}>sundrop</span>
            </div>
            <p style={landingFooterBodyLayoutStyle}>
              A secure platform for music catalog intake, storage, packaging, and publishing
              operations.
            </p>
          </div>
          <div>
            <p style={landingFooterLabelStyle}>Platform</p>
            <ul style={landingFooterListStyle}>
              <li>Music Intake</li>
              <li>The Vault</li>
              <li>Downloads</li>
            </ul>
          </div>
          <div>
            <p style={landingFooterLabelStyleAccent}>Music Ops</p>
            <ul style={landingFooterListStyle}>
              <li>Catalog Review</li>
              <li>Export Packaging</li>
              <li>YouTube Publishing</li>
            </ul>
          </div>
          <div>
            <p style={landingFooterLabelStyleTertiary}>Security</p>
            <ul style={landingFooterListStyle}>
              <li>Privacy Policy</li>
              <li>Terms of Service</li>
              <li>Status</li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  )
}

function PrivacyPage() {
  return pageShell(
    'Privacy Policy',
    <>
      <p style={leadStyle}>Effective date: March 23, 2026</p>
      <div style={legalStackStyle}>
        <section style={legalSectionStyle}>
          <h2 style={sectionTitleStyle}>Information we collect</h2>
          <p style={bodyStyle}>
            We may collect account identifiers, contact information you provide, application usage
            data, OAuth authorization data, and content metadata needed to operate the service.
          </p>
        </section>
        <section style={legalSectionStyle}>
          <h2 style={sectionTitleStyle}>How we use information</h2>
          <p style={bodyStyle}>
            We use information to authenticate users, operate the vault, process media workflows,
            improve reliability, respond to support requests, and comply with legal obligations.
          </p>
        </section>
        <section style={legalSectionStyle}>
          <h2 style={sectionTitleStyle}>Data sharing</h2>
          <p style={bodyStyle}>
            We do not sell personal information. Data may be shared with service providers and cloud
            infrastructure partners only as needed to operate the application and protect the service.
          </p>
        </section>
        <section style={legalSectionStyle}>
          <h2 style={sectionTitleStyle}>Data retention and security</h2>
          <p style={bodyStyle}>
            We retain data only as long as necessary for operations, security, compliance, and
            business continuity. Reasonable administrative, technical, and organizational safeguards
            are used to protect the application and stored data.
          </p>
        </section>
        <section style={legalSectionStyle}>
          <h2 style={sectionTitleStyle}>Contact</h2>
          <p style={bodyStyle}>
            For privacy questions or deletion requests, contact{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={inlineLinkStyle}>{SUPPORT_EMAIL}</a>.
          </p>
        </section>
      </div>
    </>,
    'Platform policy'
  )
}

function TermsPage() {
  return pageShell(
    'Terms of Service',
    <>
      <p style={leadStyle}>Effective date: March 23, 2026</p>
      <div style={legalStackStyle}>
        <section style={legalSectionStyle}>
          <h2 style={sectionTitleStyle}>Use of the service</h2>
          <p style={bodyStyle}>
            {APP_NAME} is provided for authorized business and operational use. You agree to use the
            service lawfully and only in connection with approved workflows.
          </p>
        </section>
        <section style={legalSectionStyle}>
          <h2 style={sectionTitleStyle}>Accounts and access</h2>
          <p style={bodyStyle}>
            Access may be limited, suspended, or revoked at any time to protect the application,
            users, or associated content assets. You are responsible for safeguarding your credentials.
          </p>
        </section>
        <section style={legalSectionStyle}>
          <h2 style={sectionTitleStyle}>Content and availability</h2>
          <p style={bodyStyle}>
            The service may include media metadata, files, and third-party platform references. We do
            not guarantee uninterrupted availability or that all imported content will remain available
            from external platforms.
          </p>
        </section>
        <section style={legalSectionStyle}>
          <h2 style={sectionTitleStyle}>Limitation of liability</h2>
          <p style={bodyStyle}>
            The service is provided on an as-is and as-available basis to the maximum extent permitted
            by law. We are not liable for indirect, incidental, or consequential damages arising from
            use of the application.
          </p>
        </section>
        <section style={legalSectionStyle}>
          <h2 style={sectionTitleStyle}>Contact</h2>
          <p style={bodyStyle}>
            Questions about these terms can be sent to{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={inlineLinkStyle}>{SUPPORT_EMAIL}</a>.
          </p>
        </section>
      </div>
    </>,
    'Platform policy'
  )
}

function usePageMetadata(pathname: string) {
  useEffect(() => {
    const titleByPath: Record<string, string> = {
      '/': `sundrop | Song Master Recording and Recipe`,
      '/privacy': `${APP_NAME} | Privacy Policy`,
      '/terms': `${APP_NAME} | Terms of Service`,
      '/vault': `${APP_NAME} | Vault`,
      '/control-center': `${APP_NAME} | Control Center`,
      '/login': `${APP_NAME} | Login`,
      '/signup': `${APP_NAME} | Beta Signup`,
    }

    document.title = titleByPath[pathname] || `${APP_NAME} | Vault`

    let meta = document.querySelector('meta[name="description"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'description')
      document.head.appendChild(meta)
    }

    meta.setAttribute(
      'content',
      `${APP_NAME} is a private application for SUNO vault catalog review, media operations, and YouTube workflow support.`
    )
  }, [pathname])
}

export default function App() {
  useGlobalScrollbarStyles()
  const pathname = window.location.pathname
  usePageMetadata(pathname)

  useEffect(() => {
    document.getElementById('static-fallback')?.remove()

    if (pathname === '/vanessa') {
      const next = `/vault${window.location.search || ''}${window.location.hash || ''}`
      window.location.replace(next)
    }
  }, [pathname])

  if (pathname === '/privacy') return <PrivacyPage />
  if (pathname === '/terms') return <TermsPage />
  if (pathname === '/control-center') return <AdminControlCenter />
  if (pathname === '/login') return <LoginPage />
  if (pathname === '/signup') return <SignupPage />
  if (pathname === '/vault') return <VaultGrid />
  if (pathname === '/vanessa') return null

  return <HomePage />
}

const shellStyle: CSSProperties = {
  minHeight: '100vh',
  background:
    'radial-gradient(circle at top left, rgba(124, 111, 255, 0.08), transparent 24%), radial-gradient(circle at top right, rgba(74, 38, 112, 0.06), transparent 28%), linear-gradient(180deg, #f8f9ff 0%, #eef2ff 58%, #f9fbff 100%)',
  color: '#172033',
  fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
}

const headerStyle: CSSProperties = {
  maxWidth: 1120,
  margin: '0 auto',
  padding: '24px 20px 0',
}

const headerTopStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
}

const brandStyle: CSSProperties = {
  color: '#5847d8',
  fontSize: 24,
  fontWeight: 700,
  textDecoration: 'none',
  letterSpacing: '-0.02em',
}

const navStyle: CSSProperties = {
  display: 'flex',
  gap: 16,
  flexWrap: 'wrap',
}

const navLinkStyle: CSSProperties = {
  color: '#56607b',
  textDecoration: 'none',
  fontSize: 15,
}

const mainStyle: CSSProperties = {
  maxWidth: 1120,
  margin: '0 auto',
  padding: '24px 20px 40px',
}

const heroCardStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.9)',
  border: '1px solid #d8ddf0',
  borderRadius: 24,
  boxShadow: '0 22px 64px rgba(25, 33, 61, 0.08)',
  padding: '32px clamp(20px, 3vw, 42px)',
}

const eyebrowStyle: CSSProperties = {
  margin: 0,
  color: '#6a7190',
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  fontSize: 12,
}

const titleStyle: CSSProperties = {
  margin: '10px 0 12px',
  fontSize: 'clamp(2.2rem, 5vw, 3.8rem)',
  lineHeight: 1,
  color: '#172033',
}

const leadStyle: CSSProperties = {
  margin: '0 0 20px',
  fontSize: 18,
  lineHeight: 1.6,
  color: '#4e5874',
  maxWidth: 820,
}

const legalStackStyle: CSSProperties = {
  display: 'grid',
  gap: 18,
}

const legalSectionStyle: CSSProperties = {
  padding: 18,
  borderRadius: 18,
  background: '#ffffff',
  border: '1px solid #d8ddf0',
}

const sectionTitleStyle: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 20,
  color: '#172033',
}

const bodyStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: 1.65,
  color: '#4e5874',
}

const landingToneMap: Record<string, string> = {
  primary: '#00e3fd',
  secondary: '#cdbdff',
  tertiary: '#ffbd5c',
}

const landingShellStyle: CSSProperties = {
  minHeight: '100vh',
  position: 'relative',
  overflow: 'hidden',
  background:
    'radial-gradient(circle at top left, rgba(0, 227, 253, 0.12), transparent 28%), radial-gradient(circle at top right, rgba(255, 113, 108, 0.08), transparent 26%), linear-gradient(180deg, #060608 0%, #09090d 46%, #050506 100%)',
  color: '#e7e5e7',
  fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
}

const landingGlowTopStyle: CSSProperties = {
  position: 'absolute',
  top: -180,
  left: '12%',
  width: 520,
  height: 520,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(0, 227, 253, 0.14) 0%, transparent 68%)',
  filter: 'blur(24px)',
  pointerEvents: 'none',
}

const landingGlowBottomStyle: CSSProperties = {
  position: 'absolute',
  right: '-4%',
  bottom: '10%',
  width: 620,
  height: 620,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(255, 189, 92, 0.12) 0%, transparent 64%)',
  filter: 'blur(36px)',
  pointerEvents: 'none',
}

const landingHeaderStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 30,
  backdropFilter: 'blur(18px)',
  background: 'rgba(6, 6, 8, 0.72)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
}

const landingHeaderInnerStyle: CSSProperties = {
  maxWidth: 1440,
  margin: '0 auto',
  padding: '18px clamp(18px, 2vw, 28px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
}

const landingBrandRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
}

const landingBrandStyle: CSSProperties = {
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontSize: 28,
  lineHeight: 1,
  textDecoration: 'none',
  letterSpacing: '-0.04em',
}

const landingBrandDividerStyle: CSSProperties = {
  width: 42,
  height: 1,
  background: 'rgba(255, 255, 255, 0.2)',
}

const landingSloganStyle: CSSProperties = {
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.38em',
}

const landingNavStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
}

const landingNavLinkStyle: CSSProperties = {
  color: 'rgba(231, 229, 231, 0.76)',
  textDecoration: 'none',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.28em',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
}

const landingNavButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 36,
  padding: '0 16px',
  borderRadius: 2,
  background: 'linear-gradient(135deg, #81ecff 0%, #00e3fd 100%)',
  color: '#003840',
  textDecoration: 'none',
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.24em',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
}

const landingMainStyle: CSSProperties = {
  maxWidth: 1440,
  margin: '0 auto',
  padding: '28px clamp(18px, 2vw, 28px) 80px',
  display: 'grid',
  gap: 28,
}

const landingHeroSectionStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 24,
  alignItems: 'stretch',
}

const landingHeroCopyStyle: CSSProperties = {
  position: 'relative',
  minHeight: 'clamp(420px, 56vw, 540px)',
  padding: '36px clamp(22px, 3vw, 44px) 34px',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  background:
    'linear-gradient(180deg, rgba(16, 11, 28, 0.95) 0%, rgba(10, 10, 16, 0.95) 100%)',
  boxShadow: '0 28px 80px rgba(0, 0, 0, 0.38)',
  overflow: 'hidden',
}

const landingEyebrowStyle: CSSProperties = {
  margin: 0,
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  textTransform: 'uppercase',
  letterSpacing: '0.44em',
  fontSize: 10,
}

const landingHeroTitleStyle: CSSProperties = {
  margin: '18px 0 18px',
  maxWidth: 820,
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 'clamp(3.25rem, 6.4vw, 6.3rem)',
  lineHeight: 0.92,
  letterSpacing: '-0.04em',
}

const landingHeroAccentStyle: CSSProperties = {
  color: '#00e3fd',
}

const landingHeroLeadStyle: CSSProperties = {
  maxWidth: 680,
  margin: '0 0 28px',
  color: 'rgba(231, 229, 231, 0.74)',
  fontSize: 'clamp(1rem, 1.2vw, 1.15rem)',
  lineHeight: 1.72,
}

const landingHeroCtaRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  position: 'relative',
  zIndex: 1,
}

const landingPrimaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 48,
  padding: '0 18px',
  borderRadius: 2,
  background: 'linear-gradient(135deg, #81ecff 0%, #00e3fd 100%)',
  color: '#003840',
  textDecoration: 'none',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.26em',
  boxShadow: '0 18px 36px rgba(0, 227, 253, 0.16)',
}

const landingSecondaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 48,
  padding: '0 18px',
  borderRadius: 2,
  border: '1px solid rgba(255, 255, 255, 0.08)',
  background: 'rgba(255, 255, 255, 0.02)',
  color: '#e7e5e7',
  textDecoration: 'none',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.24em',
}

const landingHeroStatCardStyle: CSSProperties = {
  position: 'relative',
  display: 'grid',
  gap: 20,
  alignContent: 'start',
  padding: 24,
  border: '1px solid rgba(255, 255, 255, 0.06)',
  background: 'rgba(24, 24, 30, 0.68)',
  boxShadow: '0 28px 80px rgba(0, 0, 0, 0.34)',
  overflow: 'hidden',
}

const landingHeroStatGroupStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
}

const landingStatKickerStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.54)',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.28em',
}

const landingStatValueStyle: CSSProperties = {
  margin: '10px 0 0',
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 'clamp(2rem, 2.6vw, 2.7rem)',
  fontWeight: 400,
  letterSpacing: '-0.03em',
}

const landingStatValueStyleAccent: CSSProperties = {
  ...landingStatValueStyle,
  color: '#cdbdff',
}

const landingStatSuffixStyle: CSSProperties = {
  color: 'rgba(231, 229, 231, 0.48)',
  fontSize: '0.44em',
  textTransform: 'uppercase',
  letterSpacing: '0.34em',
  marginLeft: 8,
}

const landingStatDividerStyle: CSSProperties = {
  height: 1,
  width: '100%',
  background: 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.12) 50%, transparent 100%)',
}

const landingHeroOrbStyle: CSSProperties = {
  position: 'absolute',
  inset: 'auto -18% -22% auto',
  width: 220,
  height: 220,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(255, 113, 108, 0.22) 0%, transparent 68%)',
  filter: 'blur(18px)',
  pointerEvents: 'none',
}

const landingPulseStripStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 18,
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 4px 0',
  borderTop: '1px solid rgba(255, 255, 255, 0.05)',
}

const landingPulseItemStyle: CSSProperties = {
  color: 'rgba(231, 229, 231, 0.72)',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  letterSpacing: '0.28em',
  textTransform: 'uppercase',
}

const landingTwoColumnSectionStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 24,
  alignItems: 'center',
  padding: '10px 0 0',
}

const landingVisualPanelStyle: CSSProperties = {
  position: 'relative',
  minHeight: 500,
  background: 'linear-gradient(180deg, rgba(12, 12, 16, 0.94) 0%, rgba(4, 4, 6, 0.95) 100%)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  overflow: 'hidden',
}

const landingVisualArtifactStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background:
    'radial-gradient(circle at 50% 18%, rgba(0, 227, 253, 0.14) 0%, transparent 24%), radial-gradient(circle at 20% 70%, rgba(205, 189, 255, 0.12) 0%, transparent 18%), radial-gradient(circle at 76% 24%, rgba(255, 113, 108, 0.12) 0%, transparent 20%), linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 18%, transparent 82%, rgba(255, 255, 255, 0.02) 100%)',
}

const landingVisualRidgeStyle: CSSProperties = {
  position: 'absolute',
  inset: '18% 10% auto',
  height: '58%',
  borderRadius: '48% 52% 38% 62% / 40% 34% 66% 60%',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  background:
    'radial-gradient(circle at 40% 36%, rgba(255, 255, 255, 0.12) 0%, transparent 18%), radial-gradient(circle at 62% 58%, rgba(255, 255, 255, 0.08) 0%, transparent 22%), linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.09) 45%, rgba(0, 0, 0, 0.05) 100%)',
  filter: 'blur(0.25px)',
  boxShadow:
    'inset 0 0 120px rgba(255, 255, 255, 0.05), 0 0 120px rgba(0, 227, 253, 0.04)',
}

const landingVisualRidgeAccentStyle: CSSProperties = {
  position: 'absolute',
  inset: '34% 24% auto',
  height: 180,
  borderRadius: '40% 60% 54% 46% / 42% 48% 52% 58%',
  background:
    'radial-gradient(circle at 50% 50%, rgba(255, 113, 108, 0.32) 0%, rgba(255, 113, 108, 0.08) 28%, transparent 62%)',
  filter: 'blur(12px)',
  mixBlendMode: 'screen',
}

const landingVisualGlowStyle: CSSProperties = {
  position: 'absolute',
  inset: 'auto 18% 10% auto',
  width: 160,
  height: 160,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(255, 189, 92, 0.24) 0%, transparent 68%)',
  filter: 'blur(10px)',
}

const landingCaptionCardStyle: CSSProperties = {
  position: 'absolute',
  right: 18,
  bottom: 18,
  zIndex: 1,
  display: 'grid',
  gap: 2,
  padding: '18px 20px',
  background: 'rgba(16, 16, 20, 0.82)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  boxShadow: '0 18px 44px rgba(0, 0, 0, 0.36)',
}

const landingCaptionTitleStyle: CSSProperties = {
  margin: 0,
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 28,
  lineHeight: 1,
}

const landingCaptionMetaStyle: CSSProperties = {
  margin: 0,
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.3em',
}

const landingCopyPanelStyle: CSSProperties = {
  display: 'grid',
  gap: 18,
  alignContent: 'start',
  padding: '8px 0',
}

const landingSectionEyebrowStyle: CSSProperties = {
  margin: 0,
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  textTransform: 'uppercase',
  letterSpacing: '0.34em',
  fontSize: 10,
}

const landingSectionTitleStyle: CSSProperties = {
  margin: 0,
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 'clamp(2.6rem, 4vw, 4.2rem)',
  lineHeight: 0.98,
  letterSpacing: '-0.04em',
  maxWidth: 760,
}

const landingSectionBodyStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.72)',
  fontSize: 16,
  lineHeight: 1.8,
  maxWidth: 700,
}

const landingChecklistStyle: CSSProperties = {
  listStyle: 'none',
  margin: '4px 0 0',
  padding: 0,
  display: 'grid',
  gap: 12,
}

const landingChecklistItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  color: '#e7e5e7',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
}

const landingChecklistDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: '#00e3fd',
  boxShadow: '0 0 0 4px rgba(0, 227, 253, 0.08)',
  flex: '0 0 auto',
}

const landingVaultSectionStyle: CSSProperties = {
  display: 'grid',
  gap: 24,
  paddingTop: 22,
}

const landingSectionHeaderRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 24,
  alignItems: 'end',
}

const landingSectionHeadingBlockStyle: CSSProperties = {
  display: 'grid',
  gap: 14,
}

const landingSectionSupportBodyStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.66)',
  fontSize: 15,
  lineHeight: 1.72,
  maxWidth: 480,
}

const landingVaultGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 1,
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
}

const landingVaultCardStyle: CSSProperties = {
  minHeight: 220,
  padding: 28,
  background: 'linear-gradient(180deg, rgba(18, 18, 22, 0.94) 0%, rgba(9, 9, 13, 0.98) 100%)',
  display: 'grid',
  alignContent: 'start',
  gap: 16,
}

const landingVaultLabelStyle: CSSProperties = {
  margin: 0,
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.26em',
}

const landingVaultTitleStyle: CSSProperties = {
  margin: 0,
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 28,
  lineHeight: 1.08,
}

const landingVaultBodyStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.7)',
  lineHeight: 1.7,
  fontSize: 14,
  maxWidth: 320,
}

const landingAscentSectionStyle: CSSProperties = {
  display: 'grid',
  gap: 22,
  paddingTop: 26,
}

const landingAscentHeadingStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  justifyItems: 'center',
  textAlign: 'center',
}

const landingAscentTitleStyle: CSSProperties = {
  margin: 0,
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 'clamp(2.8rem, 4.5vw, 4.8rem)',
  lineHeight: 1,
  letterSpacing: '-0.04em',
}

const landingAscentSubtitleStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(231, 229, 231, 0.54)',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.4em',
}

const landingAscentGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 16,
}

const landingAscentCardStyle: CSSProperties = {
  position: 'relative',
  minHeight: 280,
  overflow: 'hidden',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  padding: 22,
  display: 'grid',
  alignContent: 'end',
  backgroundColor: '#0b0b0f',
}

const landingAscentCardGlowStyle = (accent: string): CSSProperties => ({
  position: 'absolute',
  inset: '14% 18% auto',
  height: 180,
  borderRadius: '50%',
  background: `radial-gradient(circle, ${accent}2e 0%, transparent 70%)`,
  filter: 'blur(10px)',
})

const landingAscentPhaseStyle: CSSProperties = {
  margin: '0 0 8px',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.26em',
  position: 'relative',
  zIndex: 1,
}

const landingAscentCardTitleStyle: CSSProperties = {
  margin: 0,
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 28,
  lineHeight: 1,
  position: 'relative',
  zIndex: 1,
}

const landingCtaSectionStyle: CSSProperties = {
  padding: '34px 20px 10px',
  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
  display: 'grid',
  justifyItems: 'center',
  textAlign: 'center',
  gap: 14,
}

const landingCtaTitleStyle: CSSProperties = {
  margin: 0,
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 'clamp(2.8rem, 5vw, 5.2rem)',
  lineHeight: 1,
  letterSpacing: '-0.04em',
}

const landingCtaBodyStyle: CSSProperties = {
  margin: 0,
  maxWidth: 660,
  color: 'rgba(231, 229, 231, 0.68)',
  fontSize: 18,
  lineHeight: 1.72,
}

const landingPrimaryButtonLargeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 54,
  padding: '0 28px',
  borderRadius: 2,
  background: 'linear-gradient(135deg, #81ecff 0%, #00e3fd 100%)',
  color: '#003840',
  textDecoration: 'none',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.3em',
  boxShadow: '0 24px 48px rgba(0, 227, 253, 0.16)',
}

const landingProtocolRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 20,
  marginTop: 10,
  color: 'rgba(231, 229, 231, 0.34)',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
}

const landingFooterStyle: CSSProperties = {
  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
  background: '#050506',
}

const landingFooterGridStyle: CSSProperties = {
  maxWidth: 1440,
  margin: '0 auto',
  padding: '30px clamp(18px, 2vw, 28px) 34px',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 22,
}

const landingFooterBrandRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 14,
}

const landingFooterBrandStyle: CSSProperties = {
  color: '#ffffff',
  fontFamily: '"Newsreader", Georgia, serif',
  fontStyle: 'italic',
  fontSize: 22,
  lineHeight: 1,
  letterSpacing: '-0.04em',
}

const landingFooterBodyStyle: CSSProperties = {
  margin: 0,
  maxWidth: 280,
  color: 'rgba(231, 229, 231, 0.52)',
  fontSize: 12,
  lineHeight: 1.75,
}

const landingFooterLabelStyle: CSSProperties = {
  margin: '0 0 14px',
  color: '#81ecff',
  fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.28em',
}

const landingFooterLabelStyleAccent: CSSProperties = {
  ...landingFooterLabelStyle,
  color: '#cdbdff',
}

const landingFooterLabelStyleTertiary: CSSProperties = {
  ...landingFooterLabelStyle,
  color: '#ffbd5c',
}

const landingFooterListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: 10,
  color: 'rgba(231, 229, 231, 0.56)',
  fontSize: 12,
}

const footerStyle: CSSProperties = {
  maxWidth: 1120,
  margin: '0 auto',
  padding: '0 20px 32px',
  color: '#5f6885',
  fontSize: 14,
  lineHeight: 1.6,
}

const footerLinksStyle: CSSProperties = {
  display: 'flex',
  gap: 14,
  flexWrap: 'wrap',
  marginTop: 8,
}

const footerLinkStyle: CSSProperties = {
  color: '#5847d8',
  textDecoration: 'none',
}

const inlineLinkStyle: CSSProperties = {
  color: '#5847d8',
}
