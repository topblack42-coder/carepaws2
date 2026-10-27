// components/ConsentCheckbox.tsx
import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "../utils/colors";

interface ConsentCheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  testID?: string;
}

export default function ConsentCheckbox({ checked, onChange, testID }: ConsentCheckboxProps) {
  return (
    <View className="mb-4 flex-row items-start gap-3">
      <Pressable
        onPress={() => onChange(!checked)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel="I agree to the Privacy Policy and User Agreement"
        hitSlop={8}
        testID={testID}
        className={`mt-0.5 h-6 w-6 items-center justify-center rounded-md border ${checked ? "border-primary bg-primary" : "border-border bg-white"}`}
      >
        {checked && <Ionicons name="checkmark" size={16} color={colors.white} />}
      </Pressable>

      <Text className="flex-1 font-sans text-sm leading-5 text-muted">
        I confirm that I have read, consent and agree to CarePaws&apos;{" "}
        <Text className="font-sans-medium text-primary" onPress={() => router.push("/legal?doc=terms")}>
          User Agreement
        </Text>{" "}
        and{" "}
        <Text className="font-sans-medium text-primary" onPress={() => router.push("/legal?doc=privacy")}>
          Privacy Policy
        </Text>
        , and I am of legal age.
      </Text>
    </View>
  );
}
