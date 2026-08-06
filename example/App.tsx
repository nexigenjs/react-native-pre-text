/**
 * Validation harness for `@nexigen/react-native-pre-text`: every corpus case rendered
 * as a real `<Text>`, with what `measure()` predicted next to what `onLayout`
 * reported.
 *
 * @format
 */

import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { SAMPLES, type Sample } from './src/corpus';
import { FONT_OPTIONS, type FontOption } from './src/fonts';
import { MeasuredRow } from './src/MeasuredRow';
import { Summary } from './src/Summary';
import {
  CARD_MARGIN_H,
  CARD_PADDING_H,
  FONT,
  LIST_PADDING_H,
  textWidthFor,
} from './src/metrics';
import type { MeasurableStyle } from '@nexigen/react-native-pre-text';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const { width: screenWidth } = useWindowDimensions();
  const availableWidth = textWidthFor(screenWidth);
  const [selectedFont, setSelectedFont] = useState(FONT_OPTIONS[0]!);
  const font = useMemo<MeasurableStyle>(
    () => ({ ...FONT, fontFamily: selectedFont.fontFamily }),
    [selectedFont.fontFamily],
  );

  const renderItem = useMemo(
    () =>
      function renderRow({ item, index }: ListRenderItemInfo<Sample>) {
        return (
          <MeasuredRow
            sample={item}
            index={index}
            availableWidth={availableWidth}
            font={font}
          />
        );
      },
    [availableWidth, font],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <FontSelector
        selectedFont={selectedFont}
        onSelectFont={setSelectedFont}
      />
      <FlatList
        key={selectedFont.id}
        style={styles.list}
        data={SAMPLES}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={7}
        ListHeaderComponent={
          <Header
            screenWidth={screenWidth}
            availableWidth={availableWidth}
            selectedFont={selectedFont}
            font={font}
          />
        }
      />
    </SafeAreaView>
  );
}

function keyExtractor(item: Sample) {
  return item.id;
}

type HeaderProps = {
  screenWidth: number;
  availableWidth: number;
  selectedFont: FontOption;
  font: MeasurableStyle;
};

function Header({
  screenWidth,
  availableWidth,
  selectedFont,
  font,
}: HeaderProps) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>pre-text</Text>
      <Text style={styles.subtitle}>
        {SAMPLES.length} cases · {selectedFont.label} {FONT.fontSize}/
        {FONT.lineHeight}
      </Text>

      <Summary key={selectedFont.id} width={availableWidth} font={font} />

      <View style={styles.mathBox}>
        <Text style={styles.mathLine}>
          screen {screenWidth.toFixed(1)} − list padding {LIST_PADDING_H}×2 −
          card margin {CARD_MARGIN_H}×2 − card padding {CARD_PADDING_H}×2
        </Text>
        <Text style={styles.mathResult}>
          available width = {availableWidth.toFixed(1)} pt
        </Text>
      </View>
    </View>
  );
}

function FontSelector({
  selectedFont,
  onSelectFont,
}: {
  selectedFont: FontOption;
  onSelectFont: (font: FontOption) => void;
}) {
  return (
    <View style={styles.selector}>
      <Text style={styles.selectorLabel}>SWIPE TO CHANGE FONT</Text>
      <FlatList
        horizontal
        data={FONT_OPTIONS}
        keyExtractor={item => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.fontList}
        renderItem={({ item }) => {
          const selected = item.id === selectedFont.id;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelectFont(item)}
              style={[styles.fontChip, selected && styles.fontChipSelected]}
            >
              <Text
                style={[
                  styles.fontChipName,
                  { fontFamily: item.fontFamily },
                  selected && styles.fontChipNameSelected,
                ]}
              >
                {item.label}
              </Text>
              <Text style={styles.fontChipGroup}>{item.group}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0b0d10',
  },
  listContent: {
    paddingHorizontal: LIST_PADDING_H,
    paddingBottom: 32,
  },
  list: {
    flex: 1,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 16,
    gap: 8,
  },
  selector: {
    paddingHorizontal: LIST_PADDING_H,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 6,
    backgroundColor: '#0b0d10',
  },
  title: {
    color: '#f5f7fa',
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    color: '#7d8794',
    fontSize: 13,
    marginBottom: 4,
  },
  selectorLabel: {
    color: '#687485',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  fontList: {
    gap: 8,
    paddingVertical: 2,
    paddingRight: 16,
  },
  fontChip: {
    minWidth: 116,
    borderWidth: 1,
    borderColor: '#2a3038',
    borderRadius: 12,
    backgroundColor: '#15181d',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  fontChipSelected: {
    borderColor: '#4d9fff',
    backgroundColor: '#16304d',
  },
  fontChipName: {
    color: '#cbd3dc',
    fontSize: 16,
  },
  fontChipNameSelected: {
    color: '#ffffff',
  },
  fontChipGroup: {
    color: '#778291',
    fontSize: 9,
  },
  mathBox: {
    borderRadius: 10,
    backgroundColor: '#15181d',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  mathLine: {
    color: '#8794a3',
    fontSize: 11,
    fontFamily: 'Menlo',
    lineHeight: 16,
  },
  mathResult: {
    color: '#f5f7fa',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default App;
