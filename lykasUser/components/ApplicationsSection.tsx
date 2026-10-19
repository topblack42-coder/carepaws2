import { View, Text, Pressable, FlatList } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "../utils/colors";
import { MAX_HOME_APPLICATIONS, type ApplicationSummary } from "../utils/applications";
import ApplicationCard from "./ApplicationCard";
import PrimaryButton from "./PrimaryButton";
import StateView from "./StateView";

interface Props {
  applications: ApplicationSummary[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

/** "My Applications" block on Home: loading skeleton, error, empty and list states. */
export default function ApplicationsSection({ applications, loading, error, onRetry }: Props) {
  const visible = applications.slice(0, MAX_HOME_APPLICATIONS);

  return (
    <View className="mb-6">
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="font-display text-lg text-ink">My Applications</Text>
        {applications.length > 0 && (
          <Pressable
            onPress={() => router.push("/(tabs)/my-applications")}
            accessibilityRole="link"
            accessibilityLabel="See all my applications"
            className="min-h-[44px] justify-center pl-3 active:opacity-60"
          >
            <Text className="font-sans-medium text-sm text-primary">See all</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View className="h-[132px] w-[260px] rounded-2xl border border-border bg-cardBg" testID="applications-skeleton" />
      ) : error ? (
        <View className="rounded-2xl border border-border bg-white">
          <StateView state="error" title="Couldn't load applications" message={error} onRetry={onRetry} />
        </View>
      ) : visible.length === 0 ? (
        <View className="items-center gap-3 rounded-2xl border border-border bg-mintBg p-5" testID="applications-empty">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-white">
            <Ionicons name="heart" size={22} color={colors.primary} />
          </View>
          <Text className="font-display text-base text-ink">Ready to adopt?</Text>
          <Text className="text-center font-sans text-sm text-muted">Start an application and follow every step right here.</Text>
          <PrimaryButton
            label="Start an application"
            onPress={() => router.push("/(tabs)/adopt")}
            accessibilityLabel="Start an application, browse pets"
            className="min-h-[44px] self-stretch"
          />
        </View>
      ) : (
        <FlatList
          horizontal
          data={visible}
          keyExtractor={(a) => a._id}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={{ width: 260, marginRight: 12 }}>
              <ApplicationCard application={item} onPress={() => router.push(`/application-details/${item._id}`)} />
            </View>
          )}
        />
      )}
    </View>
  );
}
