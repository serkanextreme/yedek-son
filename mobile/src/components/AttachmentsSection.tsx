// Task attachments: upload (camera / gallery / document), list with image
// thumbnails or file icons, inline image preview, document open (download +
// share) and delete. Talks to the shared backend chunked-upload endpoints.

import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import {
  api,
  ApiError,
  attachmentDownloadUrl,
  templateAttachmentDownloadUrl,
  authHeader,
  uploadAttachment,
} from "@/src/api/client";
import { TaskAttachment } from "@/src/api/types";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { DETAIL } from "@/constants/testIds";

type Props = {
  taskId: string;
  onAuthError: () => void;
  // "template" → şablon ekleri (aynı UI, farklı uç noktalar).
  kind?: "task" | "template";
};

type PickedFile = { uri: string; name: string; type: string; size?: number };

function formatBytes(n?: number | null): string {
  if (!n || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

const isImage = (ct?: string | null) => (ct || "").startsWith("image/");
const isPdf = (ct?: string | null, name?: string | null) =>
  (ct || "").toLowerCase().includes("pdf") || (name || "").toLowerCase().endsWith(".pdf");

function fileIcon(ct?: string | null): keyof typeof Ionicons.glyphMap {
  const t = ct || "";
  if (t.includes("pdf")) return "document-text-outline";
  if (t.includes("sheet") || t.includes("excel") || t.includes("csv")) return "grid-outline";
  if (t.includes("word") || t.includes("document")) return "document-outline";
  if (t.startsWith("video/")) return "videocam-outline";
  if (t.startsWith("audio/")) return "musical-notes-outline";
  return "document-attach-outline";
}

export const AttachmentsSection = ({ taskId, onAuthError, kind = "task" }: Props) => {
  const insets = useSafeAreaInsets();
  const isTpl = kind === "template";
  const dlUrl = (attId: string) =>
    isTpl ? templateAttachmentDownloadUrl(taskId, attId) : attachmentDownloadUrl(taskId, attId);
  const [items, setItems] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  const [docPreview, setDocPreview] = useState<{ uri: string; name: string } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskAttachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permBlocked, setPermBlocked] = useState<string | null>(null);
  const [headers, setHeaders] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const rows = isTpl
        ? await api.listTemplateAttachments(taskId)
        : await api.listAttachments(taskId);
      setItems(rows);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
    } finally {
      setLoading(false);
    }
  }, [taskId, onAuthError, isTpl]);

  useEffect(() => {
    load();
    authHeader().then(setHeaders);
  }, [load]);

  const doUpload = useCallback(
    async (file: PickedFile) => {
      setUploading(true);
      setError(null);
      try {
        await uploadAttachment(taskId, file, kind);
        await load();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        console.warn("attachment upload failed", e);
        setError("Dosya yüklenemedi.");
      } finally {
        setUploading(false);
      }
    },
    [taskId, load, onAuthError, kind],
  );

  const ensureCamera = async (): Promise<boolean> => {
    const cur = await ImagePicker.getCameraPermissionsAsync();
    if (cur.granted) return true;
    if (cur.canAskAgain) {
      const req = await ImagePicker.requestCameraPermissionsAsync();
      if (req.granted) return true;
      if (!req.canAskAgain) setPermBlocked("Kamera");
      return false;
    }
    setPermBlocked("Kamera");
    return false;
  };

  const ensureLibrary = async (): Promise<boolean> => {
    const cur = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (cur.granted) return true;
    if (cur.canAskAgain) {
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (req.granted) return true;
      if (!req.canAskAgain) setPermBlocked("Galeri");
      return false;
    }
    setPermBlocked("Galeri");
    return false;
  };

  const pickCamera = async () => {
    setChooser(false);
    if (!(await ensureCamera())) return;
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await doUpload({
      uri: a.uri,
      name: a.fileName || `foto_${Date.now()}.jpg`,
      type: a.mimeType || "image/jpeg",
      size: a.fileSize,
    });
  };

  const pickLibrary = async () => {
    setChooser(false);
    if (!(await ensureLibrary())) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await doUpload({
      uri: a.uri,
      name: a.fileName || `resim_${Date.now()}.jpg`,
      type: a.mimeType || "image/jpeg",
      size: a.fileSize,
    });
  };

  const pickDocument = async () => {
    setChooser(false);
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await doUpload({
      uri: a.uri,
      name: a.name || `dosya_${Date.now()}`,
      type: a.mimeType || "application/octet-stream",
      size: a.size ?? undefined,
    });
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setError(null);
    try {
      await (isTpl ? api.deleteTemplateAttachment(taskId, target.id) : api.deleteAttachment(taskId, target.id));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Silinemedi");
    }
  };

  const openItem = async (att: TaskAttachment) => {
    if (isImage(att.content_type)) {
      setPreview(att);
      return;
    }
    setError(null);
    setOpening(att.id);
    try {
      const url = dlUrl(att.id);
      const safe = (att.original_filename || "dosya").replace(/[^\w.\-]+/g, "_");
      const dest = `${FileSystem.cacheDirectory}${Date.now()}_${safe}`;
      const dl = await FileSystem.downloadAsync(url, dest, { headers });
      if (isPdf(att.content_type, att.original_filename)) {
        // PDF → uygulama içi tam ekran önizleme (WebView).
        setDocPreview({ uri: dl.uri, name: att.original_filename || "dosya" });
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { mimeType: att.content_type || undefined });
      }
    } catch {
      setError("Dosya açılamadı");
    } finally {
      setOpening(null);
    }
  };

  const shareDoc = async () => {
    if (!docPreview) return;
    try {
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(docPreview.uri);
    } catch {
      setError("Paylaşılamadı");
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>EKLER {items.length > 0 ? `(${items.length})` : ""}</Text>
        <Pressable
          testID={DETAIL.attachAdd}
          onPress={() => setChooser(true)}
          disabled={uploading}
          style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={styles.addText}>Ekle</Text>
            </>
          )}
        </Pressable>
      </View>

      {permBlocked && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {permBlocked} izni reddedildi. Yüklemek için ayarlardan izin verin.
          </Text>
          <Pressable
            testID={DETAIL.attachSettings}
            onPress={() => Linking.openSettings()}
            style={({ pressed }) => [styles.settingsBtn, pressed && styles.pressed]}
          >
            <Text style={styles.settingsText}>Ayarları Aç</Text>
          </Pressable>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>Henüz dosya yok.</Text>
      ) : (
        items.map((att) => (
          <View key={att.id} style={styles.item} testID={`${DETAIL.attachItem}-${att.id}`}>
            <Pressable style={styles.itemBody} onPress={() => openItem(att)}>
              {isImage(att.content_type) ? (
                <Image
                  source={{ uri: dlUrl(att.id), headers }}
                  style={styles.thumb}
                  contentFit="cover"
                  transition={150}
                />
              ) : (
                <View style={styles.iconBox}>
                  <Ionicons name={fileIcon(att.content_type)} size={22} color={colors.secondary} />
                </View>
              )}
              <View style={styles.itemInfo}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {att.original_filename}
                </Text>
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {[formatBytes(att.size), att.uploaded_by_name].filter(Boolean).join(" · ")}
                </Text>
              </View>
              {opening === att.id && (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: spacing.xs }} />
              )}
            </Pressable>
            <Pressable
              testID={`${DETAIL.attachDelete}-${att.id}`}
              onPress={() => setDeleteTarget(att)}
              hitSlop={8}
              style={({ pressed }) => [styles.trash, pressed && styles.pressed]}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          </View>
        ))
      )}

      {/* Source chooser */}
      <Modal visible={chooser} transparent animationType="fade" onRequestClose={() => setChooser(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setChooser(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Dosya Ekle</Text>
            <Pressable testID={DETAIL.attachChooserCamera} onPress={pickCamera} style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}>
              <Ionicons name="camera-outline" size={20} color={colors.primary} />
              <Text style={styles.sheetRowText}>Kamera</Text>
            </Pressable>
            <Pressable testID={DETAIL.attachChooserLibrary} onPress={pickLibrary} style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}>
              <Ionicons name="image-outline" size={20} color={colors.primary} />
              <Text style={styles.sheetRowText}>Galeri</Text>
            </Pressable>
            <Pressable testID={DETAIL.attachChooserDocument} onPress={pickDocument} style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}>
              <Ionicons name="document-outline" size={20} color={colors.primary} />
              <Text style={styles.sheetRowText}>Dosya</Text>
            </Pressable>
            <Pressable onPress={() => setChooser(false)} style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]}>
              <Text style={styles.sheetCancelText}>İptal</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Image preview */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={styles.previewBackdrop}>
          <Pressable
            testID={DETAIL.attachPreviewClose}
            onPress={() => setPreview(null)}
            hitSlop={12}
            style={styles.previewClose}
          >
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
          {preview && (
            <Image
              source={{ uri: dlUrl(preview.id), headers }}
              style={styles.previewImage}
              contentFit="contain"
              transition={150}
            />
          )}
          {preview && <Text style={styles.previewName}>{preview.original_filename}</Text>}
        </View>
      </Modal>

      {/* Document (PDF) full-screen preview */}
      <Modal
        visible={!!docPreview}
        animationType="slide"
        onRequestClose={() => setDocPreview(null)}
      >
        <View style={[styles.pdfContainer, { paddingTop: insets.top }]}>
          <View style={styles.pdfHeader}>
            <Text style={styles.pdfName} numberOfLines={1}>
              {docPreview?.name}
            </Text>
            <Pressable
              testID="attach-doc-share"
              onPress={shareDoc}
              hitSlop={8}
              style={({ pressed }) => [styles.pdfHeaderBtn, pressed && styles.pressed]}
            >
              <Ionicons name="share-outline" size={22} color={colors.primary} />
            </Pressable>
            <Pressable
              testID="attach-doc-preview-close"
              onPress={() => setDocPreview(null)}
              hitSlop={8}
              style={({ pressed }) => [styles.pdfHeaderBtn, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={26} color={colors.textPrimary} />
            </Pressable>
          </View>
          {docPreview && (
            <WebView
              testID="attach-doc-webview"
              source={{ uri: docPreview.uri }}
              style={styles.pdfWebview}
              originWhitelist={["*"]}
              allowFileAccess
              allowFileAccessFromFileURLs
              allowUniversalAccessFromFileURLs
              startInLoadingState
              renderLoading={() => (
                <View style={styles.pdfLoading}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              )}
            />
          )}
        </View>
      </Modal>

      {/* Delete confirm */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Dosyayı sil?</Text>
            <Text style={styles.confirmBody} numberOfLines={2}>
              {deleteTarget?.original_filename}
            </Text>
            <View style={styles.confirmRow}>
              <Pressable onPress={() => setDeleteTarget(null)} style={({ pressed }) => [styles.confirmBtn, pressed && styles.pressed]}>
                <Text style={styles.confirmCancel}>İptal</Text>
              </Pressable>
              <Pressable onPress={doDelete} testID={DETAIL.attachDeleteConfirm} style={({ pressed }) => [styles.confirmBtn, styles.confirmDanger, pressed && styles.pressed]}>
                <Text style={styles.confirmDangerText}>Sil</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginTop: spacing.lg },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: colors.textMuted, fontSize: 12, letterSpacing: 1, fontFamily: monoFont },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    minWidth: 64,
    justifyContent: "center",
  },
  addText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  pressed: { opacity: 0.6 },
  banner: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  bannerText: { color: colors.textSecondary, fontSize: 13 },
  settingsBtn: { alignSelf: "flex-start", borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  settingsText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  error: { color: colors.danger, fontSize: 13 },
  empty: { color: colors.textMuted, fontStyle: "italic", fontSize: 13, paddingVertical: spacing.sm },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  itemBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  itemInfo: { flex: 1 },
  itemName: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  itemMeta: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont, marginTop: 2 },
  trash: { padding: 6 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  sheetTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "800", marginBottom: spacing.sm },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 14 },
  sheetRowText: { color: colors.textPrimary, fontSize: 15 },
  sheetCancel: { alignItems: "center", paddingVertical: 12, marginTop: spacing.sm },
  sheetCancelText: { color: colors.textMuted, fontSize: 15, fontWeight: "700" },
  previewBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  previewClose: { position: "absolute", top: 48, right: 20, zIndex: 2 },
  previewImage: { width: "92%", height: "70%" },
  previewName: { color: "#FFFFFF", fontSize: 13, marginTop: spacing.md, paddingHorizontal: spacing.lg, textAlign: "center" },
  pdfContainer: { flex: 1, backgroundColor: colors.bgBase },
  pdfHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pdfName: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  pdfHeaderBtn: { padding: 6 },
  pdfWebview: { flex: 1, backgroundColor: colors.bgBase },
  pdfLoading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgBase,
  },
  confirmBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  confirmCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  confirmTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: "800" },
  confirmBody: { color: colors.textSecondary, fontSize: 14 },
  confirmRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  confirmBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  confirmCancel: { color: colors.textSecondary, fontWeight: "700" },
  confirmDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  confirmDangerText: { color: "#FFFFFF", fontWeight: "800" },
});
