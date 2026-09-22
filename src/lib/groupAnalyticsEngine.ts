export interface ChatMessageSummary {
  id: string;
  sender_username: string;
  text_content: string;
  created_at: string;
  species_tagged: string | null;
}

export interface GroupChannelMetrics {
  totalMessagesCount: number;
  topContributor: string;
  mostTaggedSpecies: string;
  peakActivityHour: number; // 24hr format
}

/**
 * Iterates through chat records over a designated channel block to aggregate social communication statistics.
 */
export function computeGroupChatAnalytics(messages: ChatMessageSummary[]): GroupChannelMetrics {
  if (!messages || messages.length === 0) {
    return { totalMessagesCount: 0, topContributor: 'None', mostTaggedSpecies: 'None', peakActivityHour: 0 };
  }

  const senderCounts: Record<string, number> = {};
  const speciesCounts: Record<string, number> = {};
  const hourlyCounts: Record<number, number> = {};

  messages.forEach((msg) => {
    // Audit active chat communication volumes
    senderCounts[msg.sender_username] = (senderCounts[msg.sender_username] || 0) + 1;

    // Track biological tagging parameters if present
    if (msg.species_tagged) {
      const standardSpecies = msg.species_tagged.trim();
      speciesCounts[standardSpecies] = (speciesCounts[standardSpecies] || 0) + 1;
    }

    // Isolate chronological timeline nodes (UTC to avoid local-timezone skew)
    const hour = new Date(msg.created_at).getUTCHours();
    hourlyCounts[hour] = (hourlyCounts[hour] || 0) + 1;
  });

  // Identify top chat room driver
  let topContributor = 'None';
  let maxSenderCount = 0;
  Object.entries(senderCounts).forEach(([sender, count]) => {
    if (count > maxSenderCount) {
      maxSenderCount = count;
      topContributor = sender;
    }
  });

  // Isolate highest-frequency species capture entry
  let mostTaggedSpecies = 'None';
  let maxSpeciesCount = 0;
  Object.entries(speciesCounts).forEach(([species, count]) => {
    if (count > maxSpeciesCount) {
      maxSpeciesCount = count;
      mostTaggedSpecies = species;
    }
  });

  // Calculate peak engagement timeframe window
  let peakActivityHour = 0;
  let maxHourCount = 0;
  Object.entries(hourlyCounts).forEach(([hourStr, count]) => {
    const hour = Number(hourStr);
    if (count > maxHourCount) {
      maxHourCount = count;
      peakActivityHour = hour;
    }
  });

  return {
    totalMessagesCount: messages.length,
    topContributor,
    mostTaggedSpecies,
    peakActivityHour,
  };
}
