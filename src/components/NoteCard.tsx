
import { StyleSheet, View, Pressable } from "react-native";
import { useState } from "react";
import { useTheme, useThemedStyles } from "../theme/tokens";
import { Card } from "./ui/Card";
import { Typography } from "./ui/Typography";
import { Button } from "./ui/Button";

export type NoteCardItem = {
	id: string;
	personName?: string | null;
	rawNote: string;
	eventName?: string | null;
	createdAtLabel: string;
};

type NoteCardProps = {
	item: NoteCardItem;
};

export function NoteCard({ item }: NoteCardProps) {
	const styles = useThemedStyles(createStyles);
	const [expanded, setExpanded] = useState(false);
	const [showMenu, setShowMenu] = useState(false);

	return (
		<Card style={[styles.card, expanded && styles.cardExpanded]}>
			<Pressable onPress={() => setExpanded((v) => !v)} style={styles.topRow}>
				<View style={styles.personBlock}>
					<Typography variant="h2" numberOfLines={1}>
						{item.personName || "Unknown contact"}
					</Typography>
					<Typography variant="caption">{item.createdAtLabel}</Typography>
				</View>
				<Button
					label="⋮"
					variant="ghost"
					size="compact"
					onPress={() => setShowMenu((v) => !v)}
					style={styles.menuButton}
				/>
			</Pressable>

			<Typography
				variant="body"
				style={styles.note}
				numberOfLines={expanded ? undefined : 2}
			>
				{item.rawNote}
			</Typography>

			{item.eventName ? (
				<Typography variant="caption" style={styles.tag}>
					{item.eventName}
				</Typography>
			) : null}

			{/* Actions menu (placeholder, implement actions as needed) */}
			{showMenu && (
				<View style={styles.menuSheet}>
					<Button label="Edit" variant="ghost" size="compact" onPress={() => { setShowMenu(false); /* TODO: trigger edit */ }} />
					<Button label="Delete" variant="ghost" size="compact" onPress={() => { setShowMenu(false); /* TODO: trigger delete */ }} />
				</View>
			)}
		</Card>
	);
}

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({
	card: {
		paddingVertical: 12,
		paddingHorizontal: 16,
		marginBottom: 8,
	},
	cardExpanded: {
		backgroundColor: colors.surfaceMuted,
	},
	topRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
	},
	personBlock: {
		flex: 1,
		gap: 2,
	},
	note: {
		marginTop: 12,
		color: colors.textPrimary,
	},
	tag: {
		marginTop: 14,
		color: colors.textSecondary,
	},
	menuButton: {
		minWidth: 32,
		minHeight: 32,
		alignItems: "center",
		justifyContent: "center",
	},
	menuSheet: {
		position: "absolute",
		right: 16,
		top: 40,
		backgroundColor: colors.surface,
		borderRadius: 8,
		padding: 8,
		shadowColor: "#000",
		shadowOpacity: 0.1,
		shadowRadius: 8,
		elevation: 2,
		zIndex: 10,
		gap: 4,
	},
});
