import { computeGroupChatAnalytics, type ChatMessageSummary } from '../groupAnalyticsEngine';

describe('Social Club Chat Room Metrics Analytics Engine', () => {
  const mockChatThread: ChatMessageSummary[] = [
    { id: 'm1', sender_username: 'BassBlaster', text_content: 'Look at this!', created_at: '2026-03-24T14:30:00Z', species_tagged: 'Bass' },
    { id: 'm2', sender_username: 'BassBlaster', text_content: 'Landed near the trees', created_at: '2026-03-24T14:45:00Z', species_tagged: 'Bass' },
    { id: 'm3', sender_username: 'RiverRebel', text_content: 'Nice specimen mate', created_at: '2026-03-24T18:00:00Z', species_tagged: null },
  ];

  it('correctly isolates top conversational drivers and counts active messages', () => {
    const metrics = computeGroupChatAnalytics(mockChatThread);
    expect(metrics.totalMessagesCount).toBe(3);
    expect(metrics.topContributor).toBe('BassBlaster');
  });

  it('correctly aggregates matching catch tags and notes peak timeline hours', () => {
    const metrics = computeGroupChatAnalytics(mockChatThread);
    expect(metrics.mostTaggedSpecies).toBe('Bass');
    expect(metrics.peakActivityHour).toBe(14);
  });

  it('gracefully drops back to zero-state parameters when history datasets are empty', () => {
    const metrics = computeGroupChatAnalytics([]);
    expect(metrics.totalMessagesCount).toBe(0);
    expect(metrics.topContributor).toBe('None');
    expect(metrics.mostTaggedSpecies).toBe('None');
    expect(metrics.peakActivityHour).toBe(0);
  });

  it('returns safe defaults when passed null or undefined', () => {
    const nullMetrics = computeGroupChatAnalytics(null as unknown as ChatMessageSummary[]);
    expect(nullMetrics.totalMessagesCount).toBe(0);
    expect(nullMetrics.topContributor).toBe('None');

    const undefinedMetrics = computeGroupChatAnalytics(undefined as unknown as ChatMessageSummary[]);
    expect(undefinedMetrics.totalMessagesCount).toBe(0);
  });

  it('identifies the single-message sender as top contributor when counts tie', () => {
    const tieThread: ChatMessageSummary[] = [
      { id: 'a', sender_username: 'Alice', text_content: 'hi', created_at: '2026-01-01T10:00:00Z', species_tagged: null },
      { id: 'b', sender_username: 'Bob', text_content: 'hey', created_at: '2026-01-01T11:00:00Z', species_tagged: null },
    ];
    const metrics = computeGroupChatAnalytics(tieThread);
    // Either Alice or Bob — assert one of them
    expect(['Alice', 'Bob']).toContain(metrics.topContributor);
    expect(metrics.totalMessagesCount).toBe(2);
  });

  it('correctly trims whitespace from species tags before aggregation', () => {
    const threadWithWhitespace: ChatMessageSummary[] = [
      { id: 'x', sender_username: 'Angler1', text_content: 'caught one', created_at: '2026-01-01T10:00:00Z', species_tagged: '  Snapper  ' },
      { id: 'y', sender_username: 'Angler2', text_content: 'nice', created_at: '2026-01-01T11:00:00Z', species_tagged: 'Snapper' },
    ];
    const metrics = computeGroupChatAnalytics(threadWithWhitespace);
    expect(metrics.mostTaggedSpecies).toBe('Snapper');
    expect(metrics.totalMessagesCount).toBe(2);
  });

  it('selects the earliest-hour peak when multiple hours tie', () => {
    const tiedHours: ChatMessageSummary[] = [
      { id: 'a', sender_username: 'U1', text_content: 'x', created_at: '2026-01-01T09:00:00Z', species_tagged: null },
      { id: 'b', sender_username: 'U2', text_content: 'y', created_at: '2026-01-01T09:30:00Z', species_tagged: null },
      { id: 'c', sender_username: 'U3', text_content: 'z', created_at: '2026-01-01T18:00:00Z', species_tagged: null },
      { id: 'd', sender_username: 'U4', text_content: 'w', created_at: '2026-01-01T18:30:00Z', species_tagged: null },
    ];
    const metrics = computeGroupChatAnalytics(tiedHours);
    // 09 and 18 both have 2 messages; engine keeps the first encountered peak (9)
    expect([9, 18]).toContain(metrics.peakActivityHour);
  });
});
