import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import colors from "../utils/colors";
import { useReviews } from "../hooks/useReviews";
import ReviewCard from "../components/ReviewCard";
import StarRating from "../components/StarRating";
import StateView from "../components/StateView";
import WriteReviewSheet from "../components/WriteReviewSheet";

const FILTERS = [0, 5, 4, 3, 2, 1] as const;

export default function ReviewsScreen() {
  const { reviews, summary, mine, loading, error, reload } = useReviews(50);
  const [star, setStar] = useState<(typeof FILTERS)[number]>(0);
  const [writing, setWriting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const visible = useMemo(() => (star === 0 ? reviews : reviews.filter((r) => r.rating === star)), [reviews, star]);
  const pending = mine && !mine.isPublic;

  async function onRefresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  const header = (
    <View className="pb-2">
      {summary.count > 0 && (
        <View className="mb-4 flex-row items-center gap-5 rounded-2xl border border-border bg-white p-4" testID="rating-summary">
          <View className="items-center">
            <Text className="font-display text-4xl text-ink">{summary.average.toFixed(1)}</Text>
            <StarRating value={summary.average} size={14} />
            <Text className="mt-1 font-sans text-xs text-muted">
              {summary.count} {summary.count === 1 ? "review" : "reviews"}
            </Text>
          </View>
          <View className="flex-1 gap-1.5">
            {([5, 4, 3, 2, 1] as const).map((n) => {
              const count = summary.distribution[String(n) as "1"] ?? 0;
              const pct = summary.count ? (count / summary.count) * 100 : 0;
              return (
                <View key={n} className="flex-row items-center gap-2">
                  <Text className="w-3 font-sans text-xs text-muted">{n}</Text>
                  <View className="h-2 flex-1 overflow-hidden rounded-full bg-cardBg">
                    <View style={{ width: `${pct}%` }} className="h-full rounded-full bg-amber" />
                  </View>
                  <Text className="w-6 text-right font-sans text-xs text-mutedLight">{count}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      <FlatList
        horizontal
        data={FILTERS}
        keyExtractor={(f) => String(f)}
        showsHorizontalScrollIndicator={false}
        className="mb-3"
        ItemSeparatorComponent={() => <View className="w-2" />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setStar(item)}
            accessibilityRole="button"
            accessibilityState={{ selected: star === item }}
            className={`flex-row items-center gap-1 rounded-full border px-4 py-1.5 ${star === item ? "border-primary bg-primary" : "border-border bg-white"}`}
          >
            {item > 0 && <Ionicons name="star" size={12} color={star === item ? colors.white : colors.amber} />}
            <Text className={`font-sans-medium text-sm ${star === item ? "text-white" : "text-ink"}`}>{item === 0 ? "All" : item}</Text>
          </Pressable>
        )}
      />
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-2 px-5 pb-3 pt-2">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="p-1">
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <Text className="font-display text-xl text-ink">Reviews</Text>
      </View>

      {loading ? (
        <StateView state="loading" />
      ) : error ? (
        <StateView state="error" message={error} onRetry={reload} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(r) => r._id}
          contentContainerClassName="px-5 pb-6"
          ListHeaderComponent={header}
          ItemSeparatorComponent={() => <View className="h-3" />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <StateView
              state="empty"
              title={star ? `No ${star}-star reviews` : "No reviews yet"}
              message={star ? "Try another rating." : "Be the first to share your experience."}
            />
          }
          renderItem={({ item }) => <ReviewCard review={item} />}
        />
      )}

      {!loading && !error && (
        <View className="border-t border-border bg-cream px-5 pb-2 pt-3">
          {pending ? (
            <View className="flex-row items-center gap-2 rounded-xl px-4 py-3" style={{ backgroundColor: colors.status.warningBg }}>
              <Ionicons name="time-outline" size={18} color={colors.amber600} />
              <Text className="flex-1 font-sans text-sm text-slate">Your review is awaiting approval.</Text>
            </View>
          ) : mine ? (
            <Text className="py-2 text-center font-sans text-sm text-muted">Thanks for sharing your review!</Text>
          ) : (
            <Pressable onPress={() => setWriting(true)} accessibilityRole="button" className="flex-row items-center justify-center gap-2 rounded-xl bg-primary py-3.5 active:opacity-80">
              <Ionicons name="create-outline" size={18} color={colors.white} />
              <Text className="font-sans-bold text-base text-white">Write a review</Text>
            </Pressable>
          )}
        </View>
      )}

      <WriteReviewSheet visible={writing} onClose={() => setWriting(false)} onSubmitted={reload} />
    </SafeAreaView>
  );
}
