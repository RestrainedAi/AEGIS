import type { SignupTierOption } from '../types'
import tierCatalogConfig from '../../shared/tierCatalog.json'

type TierCatalogShape = {
  tiers?: SignupTierOption[]
}

export const signupCatalog: SignupTierOption[] = ((tierCatalogConfig as TierCatalogShape).tiers || []).map((tier) => ({
  ...tier,
})) as SignupTierOption[]

export const signupCatalogById = Object.fromEntries(
  signupCatalog.map((tier) => [tier.id, tier] as const)
)

export const publicBetaTierIds = signupCatalog
  .filter((tier) => tier.publicBetaVisible)
  .map((tier) => tier.id)

export const betaMigrationTierIds = signupCatalog
  .filter((tier) => tier.id !== 'artist')
  .map((tier) => tier.id)
