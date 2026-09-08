// Manual mock picked up automatically for react-native-reanimated (like the
// sortables mock beside it). Intentionally minimal: only what components
// import — RecipeForm's Animated.ScrollView + useAnimatedRef, ShoppingRow's
// layout animations and animated style. Animations are inert: layout presets
// are chainable no-ops, animated styles resolve synchronously, and
// Animated.View drops the animation props so they never reach the host view.
// Extend it whenever new reanimated APIs are used, or every suite fails far
// from the cause.
import React from 'react';
import { ScrollView, View, type ViewProps } from 'react-native';

type AnimatedViewProps = ViewProps & { entering?: unknown; exiting?: unknown; layout?: unknown };

const AnimatedView = React.forwardRef<View, AnimatedViewProps>(function AnimatedView(
  { entering: _entering, exiting: _exiting, layout: _layout, ...props },
  ref
) {
  return <View ref={ref} {...props} />;
});

function preset() {
  const self: Record<string, () => unknown> = {};
  self.duration = () => self;
  self.delay = () => self;
  self.springify = () => self;
  return self;
}

export const useAnimatedRef = () => ({ current: null });
export const useSharedValue = <T,>(initial: T) => ({ value: initial });
export const useAnimatedStyle = <T,>(factory: () => T) => factory();
export const withTiming = <T,>(value: T) => value;
export const interpolateColor = (value: number, _input: number[], output: string[]) =>
  output[value >= 1 ? 1 : 0];
export const FadeIn = preset();
export const FadeInDown = preset();
export const FadeOut = preset();
export const FadeOutLeft = preset();
export const LinearTransition = preset();

export default {
  ScrollView,
  View: AnimatedView,
  createAnimatedComponent: <C,>(component: C) => component,
};
