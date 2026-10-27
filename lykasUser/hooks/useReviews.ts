import { useCallback, useEffect, useState } from "react";
import { useRealtime } from "../context/RealtimeContext";
import { api, getApiErrorMessage } from "../utils/api";
import type { Review } from "../components/ReviewCard";

export interface ReviewSummary {
  average: number;
  count: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}

/** The signed-in user's own standalone review, if any (it may still be awaiting approval). */
export interface MyReview {
  _id: string;
  rating: number | null;
  status: string;
  isPublic: boolean;
}

const EMPTY_SUMMARY: ReviewSummary = { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };

export function useReviews(limit = 20) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [summary, setSummary] = useState<ReviewSummary>(EMPTY_SUMMARY);
  const [mine, setMine] = useState<MyReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get("/api/feedback/reviews", { params: { limit } });
      setReviews(res.data.data.reviews);
      setSummary(res.data.data.summary);
      setMine(res.data.data.mine);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load reviews"));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  // Fires for the reviewer and staff — picks up "your review was approved".
  useRealtime(["Feedback"], () => {
    void load();
  });

  return { reviews, summary, mine, loading, error, reload: load };
}
