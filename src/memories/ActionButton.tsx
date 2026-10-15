import { memo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

type Props = {
  testID: string;
  label: string;
  accessibilityLabel?: string;
  disabled: boolean;
  dimmed: boolean;
  onPress: () => void;
};

export const ActionButton = memo(function ActionButton({
  testID, label, accessibilityLabel, disabled, dimmed, onPress,
}: Props) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      disabled={disabled} onPress={onPress} style={[styles.button, dimmed && styles.dimmed]}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: { flex: 1, alignItems: "center", padding: 14, borderRadius: 25, backgroundColor: "#547560" },
  label: { color: "#ffffff", fontWeight: "600", fontSize: 15 },
  dimmed: { opacity: 0.45 },
});
