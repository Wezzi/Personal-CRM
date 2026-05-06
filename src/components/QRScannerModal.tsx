import { useState } from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { Button } from "./ui/Button";
import { Typography } from "./ui/Typography";
import { layout, radius, useTheme, useThemedStyles } from "../theme/tokens";

type QRScannerModalProps = {
  visible: boolean;
  onClose: () => void;
  onScanned: (value: string) => void;
};

export function QRScannerModal({ visible, onClose, onScanned }: QRScannerModalProps) {
  const styles = useThemedStyles(createStyles);
  const [permission, requestPermission] = useCameraPermissions();
  const [hasScanned, setHasScanned] = useState(false);

  const granted = Boolean(permission?.granted);

  function handleClose() {
    setHasScanned(false);
    onClose();
  }

  async function handleRequestPermission() {
    await requestPermission();
  }

  function handleBarcodeScanned(event: { data: string }) {
    if (hasScanned) {
      return;
    }

    setHasScanned(true);
    onScanned(event.data);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Typography variant="caption">Scan QR</Typography>
            <Typography variant="h1">Point the camera at a QR code</Typography>
            <Typography variant="body" style={styles.helperText}>
              We will pull out anything useful, then send you back to review the contact.
            </Typography>
          </View>
          <Pressable onPress={handleClose} hitSlop={12} style={styles.closePill}>
            <Typography variant="caption" style={styles.closeText}>Close</Typography>
          </Pressable>
        </View>

        {!granted ? (
          <View style={styles.permissionWrap}>
            <Typography variant="body" style={styles.helperText}>
              Camera access is needed to scan QR codes.
            </Typography>
            <View style={styles.buttonStack}>
              <Button label="Allow camera" onPress={handleRequestPermission} />
              <Button label="Cancel" onPress={handleClose} variant="ghost" />
            </View>
          </View>
        ) : (
          <View style={styles.cameraShell}>
            <CameraView
              style={styles.camera}
              barcodeScannerSettings={{
                barcodeTypes: ["qr", "pdf417", "code128", "code39", "ean13"],
              }}
              onBarcodeScanned={handleBarcodeScanned}
            />
            <View style={styles.overlayCard}>
              <Typography variant="body" style={styles.overlayText}>
                Scan LinkedIn QR, a contact QR, or any code that contains a URL, email, phone, or vCard.
              </Typography>
            </View>
            <View style={styles.footer}>
              <Button label="Cancel" onPress={handleClose} variant="ghost" />
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.screenPaddingHorizontal,
    paddingTop: layout.sectionGap,
    paddingBottom: layout.sectionGap,
    gap: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 8,
  },
  helperText: {
    color: colors.textSecondary,
  },
  closePill: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  closeText: {
    color: colors.textSecondary,
  },
  permissionWrap: {
    flex: 1,
    justifyContent: "center",
    gap: 16,
  },
  buttonStack: {
    gap: 10,
  },
  cameraShell: {
    flex: 1,
    gap: 14,
  },
  camera: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: colors.surfaceMuted,
  },
  overlayCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
  },
  overlayText: {
    color: colors.textSecondary,
  },
  footer: {
    gap: 10,
  },
});
