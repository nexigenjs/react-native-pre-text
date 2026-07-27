/**
 * Validation harness for `@nexigen/react-native-pre-text`: every corpus case rendered
 * as a real `<Text>`, with what `measure()` predicted next to what `onLayout`
 * reported.
 *
 * @format
 */

import { useMemo } from 'react';
import {
  FlatList,
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
import { MeasuredRow } from './src/MeasuredRow';
import { Summary } from './src/Summary';
import {
  CARD_MARGIN_H,
  CARD_PADDING_H,
  FONT,
  LIST_PADDING_H,
  textWidthFor,
} from './src/metrics';

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

  const renderItem = useMemo(
    () =>
      function renderRow({ item, index }: ListRenderItemInfo<Sample>) {
        return (
          <MeasuredRow
            sample={item}
            index={index}
            availableWidth={availableWidth}
          />
        );
      },
    [availableWidth],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <FlatList
        data={SAMPLES}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={7}
        ListHeaderComponent={
          <Header screenWidth={screenWidth} availableWidth={availableWidth} />
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
};

function Header({ screenWidth, availableWidth }: HeaderProps) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>pre-text</Text>
      <Text style={styles.subtitle}>
        {SAMPLES.length} cases · {FONT.fontFamily} {FONT.fontSize}/
        {FONT.lineHeight}
      </Text>

      <Summary width={availableWidth} />

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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0b0d10',
  },
  listContent: {
    paddingHorizontal: LIST_PADDING_H,
    paddingBottom: 32,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 16,
    gap: 8,
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
