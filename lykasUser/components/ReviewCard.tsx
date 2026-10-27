import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "../utils/colors";
import { formatRelativeTime } from "../utils/format";
import StarRating from "./StarRating";

export interface Review {
  _id: string;
  rating: number | null;
  subject: string;
  message: string;
  createdAt: string;
  isFeatured: boolean;
  adminResponse: string;
  reviewer: { name: string };
  pet: { _id: string; name: string } | null;
  isMine: boolean;
}

interface Props {
  review: Review;
  /** Fixed width for horizontal carousels; omit to fill the parent. */
  width?: number;
  /** Clamp the message (carousel preview). */
  compact?: boolean;
}

export default function ReviewCard({ review, width, compact }: Props) {
  const initial = review.reviewer.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <View
      style={width ? { width } : undefined}
      className="rounded-2xl border border-border bg-white p-4"
      accessible
      accessibilityLabel={`Review by ${review.reviewer.name}${review.rating ? `, ${review.rating} stars` : ""}. ${review.message}`}
    >
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-mintBg">
          <Text className="font-display text-base text-primary">{initial}</Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="flex-shrink font-sans-medium text-sm text-ink" numberOfLines={1}>
              {review.reviewer.name}
            </Text>
            {review.isMine && (
              <View className="rounded-full bg-cardBg px-2 py-0.5">
                <Text className="font-sans-medium text-[10px] text-slate">You</Text>
              </View>
            )}
          </View>
          <Text className="font-sans text-xs text-mutedLight">{formatRelativeTime(review.createdAt)}</Text>
        </View>
        {review.isFeatured && <Ionicons name="ribbon" size={18} color={colors.amber600} />}
      </View>

      {review.rating ? (
        <View className="mt-3">
          <StarRating value={review.rating} size={15} />
        </View>
      ) : null}

      {review.pet && (
        <View className="mt-2 self-start flex-row items-center gap-1 rounded-full bg-peachBg px-2.5 py-1">
          <Ionicons name="paw" size={11} color={colors.accentOrange} />
          <Text className="font-sans-medium text-xs text-accentOrange">Adopted {review.pet.name}</Text>
        </View>
      )}

      {!!review.subject && <Text className="mt-2 font-sans-bold text-sm text-ink">{review.subject}</Text>}
      <Text className="mt-1 font-sans text-sm leading-5 text-slate" numberOfLines={compact ? 4 : undefined}>
        {review.message}
      </Text>

      {!!review.adminResponse && !compact && (
        <View className="mt-3 rounded-xl bg-mintBg p-3">
          <Text className="font-sans-medium text-xs text-ink">CarePaws replied</Text>
          <Text className="mt-1 font-sans text-sm text-slate">{review.adminResponse}</Text>
        </View>
      )}
    </View>
  );
}
