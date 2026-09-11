import React from 'react';
import { View } from 'react-native';

let lastGridProps: any = null;

export function __getLastGridProps() {
  return lastGridProps;
}

function Grid(props: any) {
  // Test-only capture so specs can drive onDragEnd; not a real component.
  // eslint-disable-next-line react-hooks/globals
  lastGridProps = props;
  return (
    <View>
      {props.data.map((item: any, index: number) => (
        <View key={item.key ?? item.id ?? String(index)}>{props.renderItem({ item, index })}</View>
      ))}
    </View>
  );
}

function Handle({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export default { Grid, Handle };
