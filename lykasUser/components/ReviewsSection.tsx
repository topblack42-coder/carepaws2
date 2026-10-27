import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "../utils/colors";
import { useReviews } from "../hooks/useReviews";
import ReviewCard from "./ReviewCard";
import StarRating from "./StarRating";
import WriteReviewSheet from "./WriteReviewSheet";

/** Home-screen preview: rating summary, a carousel of adopter reviews, and a write-a-review CTA. */
export default function ReviewsSection() {
  const { reviews, summary, mine, loading, error, reload } = useReviews(6);
  const [writing, setWriting] = useState(false);

  if (loading || error) return null; // optional section: never block or break Home

  const pending = mine && !mine.isPublic;

  return (
    <View className="mb-6">
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="font-display text-lg text-ink">What adopters say</Text>
        {reviews.length > 0 && (
          <Pressable
            onPress={() => router.push("/reviews")}
            accessibilityRole="link"
            accessibilityLabel="See all reviews"
            className="min-h-[44px] justify-center pl-3 active:opacity-60"
          >
            <Text className="font-sans-medium text-sm text-primary">See all</Text>
          </Pressable>
        )}
      </View>

      {summary.count > 0 && (
        <View className="mb-3 flex-row items-center gap-2">
          <Text className="font-display text-2xl text-ink">{summary.average.toFixed(1)}</Text>
          <StarRating value={summary.average} size={16} />
          <Text className="font-sans text-sm text-muted">
            · {summary.count} {summary.count === 1 ? "review" : "reviews"}
          </Text>
        </View>
      )}

      {reviews.length === 0 ? (
        <View className="items-center rounded-2xl border border-border bg-white px-5 py-6">
          <Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.sand} />
          <Text className="mt-2 font-sans-medium text-base text-ink">No reviews yet</Text>
          <Text className="mt-1 text-center font-sans text-sm text-muted">Be the first to share how CarePaws helped you.</Text>
        </View>
      ) : (
        <FlatList
          horizontal
          data={reviews}
          keyExtractor={(r) => r._id}
          showsHorizontalScrollIndicator={false}
          ItemSeparatorComponent={() => <View className="w-3" />}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push("/reviews")} accessibilityRole="button">
              <ReviewCard review={item} width={280} compact />
            </Pressable>
          )}
        />
      )}

      {pending ? (
        <View className="mt-3 flex-row items-center gap-2 rounded-xl px-4 py-3" style={{ backgroundColor: colors.status.warningBg }}>
          <Ionicons name="time-outline" size={18} color={colors.amber600} />
          <Text className="flex-1 font-sans text-sm text-slate">Your review is awaiting approval. Thanks for sharing!</Text>
        </View>
      ) : !mine ? (
        <Pressable
          onPress={() => setWriting(true)}
          accessibilityRole="button"
          className="mt-3 flex-row items-center justify-center gap-2 rounded-xl border border-primary py-3 active:opacity-60"
        >
          <Ionicons name="create-outline" size={18} color={colors.primary} />
          <Text className="font-sans-bold text-base text-primary">Write a review</Text>
        </Pressable>
      ) : null}

      <WriteReviewSheet visible={writing} onClose={() => setWriting(false)} onSubmitted={reload} />
    </View>
  );
}
