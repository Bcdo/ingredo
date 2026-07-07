import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { Button } from '../components/ui/Button';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Stepper } from '../components/ui/Stepper';

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
