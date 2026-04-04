/**
 * Scan Lab — pure scanning R&D app.
 * Camera → Gemini → Results. Nothing else.
 * Step 1: Raw Gemini identification (no OL, no Google Books, no dedup, no filters)
 */
import { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Image, SafeAreaView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

// Gemini API key — same as ShelfScanner
const GEMINI_API_KEY = 'AIzaSyDW7u1JRDBaWL0R1HpM3BClb-TH7dspjbs';

type Phase = 'camera' | 'processing' | 'results';

interface DetectedBook {
  title: string;
  author: string | null;
  confidence: string;
  subtitle: string | null;
  series: string | null;
  position: number;
}

export default function App() {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('camera');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [books, setBooks] = useState<DetectedBook[]>([]);
  const [rawResponse, setRawResponse] = useState<string>('');
  const [timing, setTiming] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const takePicture = async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({
      quality: 0.8,
      exif: true,
    });
    if (photo) {
      const result = await manipulateAsync(photo.uri, [{ rotate: 0 }], {
        compress: 0.8,
        format: SaveFormat.JPEG,
      });
      processPhoto(result.uri);
    }
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      processPhoto(result.assets[0].uri);
    }
  };

  const processPhoto = async (uri: string) => {
    setPhotoUri(uri);
    setPhase('processing');
    setError(null);
    setBooks([]);
    setRawResponse('');

    const t0 = Date.now();

    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await runGemini(base64, t0);
    } catch (e: any) {
      setError(e.message || 'Unknown error');
      setPhase('results');
    }
  };

  const runGemini = async (base64: string, t0: number) => {
    const prompt = `Look at this photo of a bookshelf. Identify EVERY book you can see from their spines.

For EACH book, provide:
- title: the FULL title including any subtitle (e.g., "Artemis Fowl: The Lost Colony" not just "Artemis Fowl")
- author: if visible on the spine
- confidence: "high", "medium", or "low"
- subtitle: if the title has a series name + subtitle, extract the subtitle separately
- series: if part of a series, the series name

IMPORTANT:
- Read ALL text on each spine, including small subtitle text
- The series name and subtitle on ONE spine = ONE book, not two
- Author name on a spine is part of that book, not a separate book
- Publisher names (Penguin, Scholastic, Hyperion, Speak, Philomel, etc.) are NOT books — skip them
- Go left to right

Return JSON array: [{"title": "...", "author": "...", "confidence": "...", "subtitle": "...", "series": "..."}]
Return ONLY the JSON array, no other text.`;

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'image/jpeg', data: base64 } },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
        }),
      }
    );

    const elapsed = Date.now() - t0;
    setTiming(elapsed);

    if (!resp.ok) {
      throw new Error(`Gemini API error: ${resp.status}`);
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    setRawResponse(text);

    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        setBooks(parsed.map((b: any, i: number) => ({
          title: b.title || '?',
          author: b.author || null,
          confidence: b.confidence || 'unknown',
          subtitle: b.subtitle || null,
          series: b.series || null,
          position: i + 1,
        })));
      } else {
        setError('Could not parse JSON from Gemini response');
      }
    } catch (e) {
      setError('JSON parse error: ' + text.slice(0, 200));
    }

    setPhase('results');
  };

  // ── Camera ──
  if (phase === 'camera') {
    if (!permission) return <View style={s.container} />;
    if (!permission.granted) {
      return (
        <SafeAreaView style={s.container}>
          <View style={s.center}>
            <Text style={s.title}>Camera Permission Needed</Text>
            <TouchableOpacity style={s.btn} onPress={requestPermission}>
              <Text style={s.btnText}>Allow Camera</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return (
      <View style={s.container}>
        <CameraView ref={cameraRef} style={s.camera} facing="back">
          <SafeAreaView style={s.cameraTop}>
            <Text style={s.cameraTitle}>Scan Lab</Text>
            <Text style={s.cameraSubtitle}>Pure Gemini · No filters · Raw results</Text>
          </SafeAreaView>
          <SafeAreaView>
            <View style={s.cameraBottom}>
              <TouchableOpacity style={s.libBtn} onPress={pickFromLibrary}>
                <Text style={s.libBtnText}>Photo Library</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.shutter} onPress={takePicture}>
                <View style={s.shutterInner} />
              </TouchableOpacity>
              <View style={{ width: 80 }} />
            </View>
          </SafeAreaView>
        </CameraView>
      </View>
    );
  }

  // ── Processing ──
  if (phase === 'processing') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.center}>
          <ActivityIndicator size="large" color="#C9923C" />
          <Text style={s.title}>Asking Gemini...</Text>
          {photoUri && <Image source={{ uri: photoUri }} style={s.previewSmall} />}
        </View>
      </SafeAreaView>
    );
  }

  // ── Results ──
  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.results}>
        <View style={s.header}>
          <Text style={s.title}>{books.length} Books Found</Text>
          <Text style={s.subtitle}>Gemini Flash · {(timing / 1000).toFixed(1)}s</Text>
        </View>

        {photoUri && <Image source={{ uri: photoUri }} style={s.previewLarge} />}

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {books.map((book, i) => (
          <View key={i} style={s.bookRow}>
            <Text style={s.bookNum}>{book.position}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.bookTitle}>{book.title}</Text>
              {book.author && <Text style={s.bookAuthor}>by {book.author}</Text>}
              {book.series && <Text style={s.bookSeries}>Series: {book.series}</Text>}
              <Text style={[s.conf, {
                color: book.confidence === 'high' ? '#28A745' : book.confidence === 'medium' ? '#FFC107' : '#DC3545'
              }]}>{book.confidence}</Text>
            </View>
          </View>
        ))}

        {rawResponse ? (
          <View style={s.rawBox}>
            <Text style={s.rawLabel}>Raw Gemini Response:</Text>
            <Text style={s.rawText}>{rawResponse}</Text>
          </View>
        ) : null}

        <View style={s.actions}>
          <TouchableOpacity style={s.btn} onPress={() => setPhase('camera')}>
            <Text style={s.btnText}>Scan Again</Text>
          </TouchableOpacity>
          {photoUri && (
            <TouchableOpacity style={s.btnSec} onPress={() => processPhoto(photoUri)}>
              <Text style={s.btnSecText}>Re-scan Same Photo</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1714' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#EDE7DC', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#9B9488', textAlign: 'center' },

  camera: { flex: 1, justifyContent: 'space-between' },
  cameraTop: { alignItems: 'center', paddingTop: 8 },
  cameraTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  cameraSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  cameraBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 32, paddingBottom: 16 },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  libBtn: { width: 80, alignItems: 'center' },
  libBtnText: { color: '#fff', fontSize: 12 },

  previewSmall: { width: 200, height: 150, borderRadius: 8, marginTop: 16 },
  previewLarge: { width: '100%', height: 200, borderRadius: 8, marginBottom: 16 },

  results: { padding: 16, paddingBottom: 100 },
  header: { marginBottom: 12 },

  bookRow: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#3A3530' },
  bookNum: { fontSize: 16, fontWeight: '700', color: '#C9923C', width: 24, textAlign: 'center' },
  bookTitle: { fontSize: 15, fontWeight: '600', color: '#EDE7DC' },
  bookAuthor: { fontSize: 13, color: '#9B9488', marginTop: 2 },
  bookSeries: { fontSize: 12, color: '#C9923C', marginTop: 2 },
  conf: { fontSize: 11, fontWeight: '600', marginTop: 4 },

  errorBox: { backgroundColor: '#DC354520', padding: 12, borderRadius: 8, marginBottom: 12 },
  errorText: { color: '#DC3545', fontSize: 13 },

  rawBox: { backgroundColor: '#231F1B', padding: 12, borderRadius: 8, marginTop: 16 },
  rawLabel: { fontSize: 12, fontWeight: '600', color: '#9B9488', marginBottom: 4 },
  rawText: { fontSize: 11, color: '#666' },

  actions: { gap: 8, marginTop: 24 },
  btn: { backgroundColor: '#C9923C', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  btnSec: { borderWidth: 1, borderColor: '#C9923C', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnSecText: { fontSize: 16, fontWeight: '600', color: '#C9923C' },
});
