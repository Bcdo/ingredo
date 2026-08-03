import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Stepper } from '../components/ui/Stepper';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('Button', () => {
  it('fires onPress', () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} />);
    fireEvent.press(screen.getByText('Save'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} disabled />);
    fireEvent.press(screen.getByText('Save'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Stepper', () => {
  it('increments and decrements', () => {
    const onChange = jest.fn();
    render(<Stepper value={4} onChange={onChange} />);
    fireEvent.press(screen.getByLabelText('increment'));
    expect(onChange).toHaveBeenCalledWith(5);
    fireEvent.press(screen.getByLabelText('decrement'));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('never goes below min', () => {
    const onChange = jest.fn();
    render(<Stepper value={1} onChange={onChange} />);
    fireEvent.press(screen.getByLabelText('decrement'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SegmentedControl', () => {
  it('renders all segments and marks the selected one', () => {
    render(
      <SegmentedControl
        segments={[
          { key: 'metric', label: 'Metric' },
          { key: 'us', label: 'US' },
        ]}
        selected="metric"
        onSelect={jest.fn()}
      />
    );
    expect(screen.getByText('Metric')).toBeTruthy();
    expect(screen.getByText('US')).toBeTruthy();
    expect(screen.getByLabelText('Metric').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(screen.getByLabelText('US').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false })
    );
  });

  it('reports the tapped segment key', () => {
    const onSelect = jest.fn();
    render(
      <SegmentedControl
        segments={[
          { key: 'metric', label: 'Metric' },
          { key: 'us', label: 'US' },
        ]}
        selected="metric"
        onSelect={onSelect}
      />
    );
    fireEvent.press(screen.getByLabelText('US'));
    expect(onSelect).toHaveBeenCalledWith('us');
  });
});

describe('Input', () => {
  it('secure toggle reveals and re-hides the password', () => {
    render(
      <Input value="hemmelig" onChangeText={() => {}} secureTextEntry secureToggle testID="pw" />
    );
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getByLabelText('Show password'));
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(false);

    fireEvent.press(screen.getByLabelText('Hide password'));
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);
  });

  it('renders no toggle without secureToggle', () => {
    render(<Input value="x" onChangeText={() => {}} secureTextEntry testID="pw" />);
    expect(screen.queryByLabelText('Show password')).toBeNull();
  });

  it('passes autoFocus through to the native input', () => {
    render(<Input value="x" onChangeText={() => {}} autoFocus testID="field" />);
    expect(screen.getByTestId('field').props.autoFocus).toBe(true);
  });
});
