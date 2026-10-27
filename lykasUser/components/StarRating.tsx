import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "../utils/colors";

interface Props {
  value: number;
  size?: number;
  /** When provided the stars become tappable inputs. */
  onChange?: (value: number) => void;
}

/** Read-only (supports halves) or interactive 5-star rating. */
export default function StarRating({ value, size = 16, onChange }: Props) {
  const stars = [1, 2, 3, 4, 5];

  if (onChange) {
    return (
      <View className="flex-row gap-1.5" accessibilityRole="adjustable" accessibilityLabel={`Rating: ${value} of 5 stars`}>
        {stars.map((n) => (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`${n} ${n === 1 ? "star" : "stars"}`}
            accessibilityState={{ selected: n === value }}
            className="active:opacity-60"
          >
            <Ionicons name={n <= value ? "star" : "star-outline"} size={size} color={n <= value ? colors.amber : colors.gray300} />
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <View className="flex-row gap-0.5" accessible accessibilityLabel={`${value} out of 5 stars`}>
      {stars.map((n) => {
        const name = value >= n - 0.25 ? "star" : value >= n - 0.75 ? "star-half" : "star-outline";
        return <Ionicons key={n} name={name} size={size} color={name === "star-outline" ? colors.gray300 : colors.amber} />;
      })}
    </View>
  );
}
