import { fetchUserSubscriptionDetails, launchPremiumCheckoutSession } from '../stripeEngine';
import { supabase } from '../supabase';

const mockSingleResult: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve(mockSingleResult)),
        })),
      })),
    })),
    functions: {
      invoke: jest.fn(async () => ({ data: { checkoutUrl: 'https://checkout.stripe.com/test' }, error: null })),
    },
  },
}));

describe('Billing Matrix Verification Network', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSingleResult.data = null;
    mockSingleResult.error = null;
  });

  it('correctly maps backend subscription record configurations to explicit model entities', async () => {
    mockSingleResult.data = { is_premium: true, subscription_status: 'active', stripe_customer_id: 'cus_123' };
    mockSingleResult.error = null;

    const details = await fetchUserSubscriptionDetails('u123');
    expect(details.isPremium).toBe(true);
    expect(details.status).toBe('active');
    expect(details.customerId).toBe('cus_123');
  });

  it('returns default values when the profile record is missing', async () => {
    mockSingleResult.data = null;
    mockSingleResult.error = new Error('not found');

    const details = await fetchUserSubscriptionDetails('missing-user');
    expect(details.isPremium).toBe(false);
    expect(details.status).toBe('error');
    expect(details.customerId).toBeNull();
  });

  it('returns default values when the profile record has no premium flags', async () => {
    mockSingleResult.data = { is_premium: false, subscription_status: 'inactive', stripe_customer_id: null };
    mockSingleResult.error = null;

    const details = await fetchUserSubscriptionDetails('free-user');
    expect(details.isPremium).toBe(false);
    expect(details.status).toBe('inactive');
    expect(details.customerId).toBeNull();
  });

  it('invokes the Stripe checkout edge function and returns the checkout URL on success', async () => {
    const url = await launchPremiumCheckoutSession('u456');
    expect(url).toBe('https://checkout.stripe.com/test');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('create-stripe-checkout', { body: { userId: 'u456' } });
  });

  it('returns null when the Stripe checkout edge function call fails', async () => {
    (supabase.functions.invoke as jest.Mock).mockRejectedValueOnce(new Error('edge function down'));

    const url = await launchPremiumCheckoutSession('u789');
    expect(url).toBeNull();
  });
});
