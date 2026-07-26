import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { QuantityEditor } from '../components/shop/QuantityEditor';

const item = { id: 's1', name: 'Melk', quantity: 2, unit: 'l' };

describe('QuantityEditor', () => {
  it('shows the item name and current values', () => {
    render(<QuantityEditor item={item} onSave={jest.fn()} onCancel={jest.fn()} />);

    expect(screen.getByText('Melk')).toBeOnTheScreen();
    expect(screen.getByTestId('quantity-input').props.value).toBe('2');
  });

  it('saves an edited amount and unit', () => {
    const onSave = jest.fn();
    render(<QuantityEditor item={item} onSave={onSave} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('quantity-input'), '1,5');
    fireEvent.press(screen.getByText('kg'));
    fireEvent.press(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith(1.5, 'kg');
  });

  it('a blank amount saves as null with null unit', () => {
    const onSave = jest.fn();
    render(<QuantityEditor item={item} onSave={onSave} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('quantity-input'), '');
    fireEvent.press(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith(null, null);
  });

  it('selecting the none chip clears the unit', () => {
    const onSave = jest.fn();
    render(<QuantityEditor item={item} onSave={onSave} onCancel={jest.fn()} />);

    fireEvent.press(screen.getByTestId('unit-none'));
    fireEvent.press(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith(2, null);
  });

  it('cancel does not save', () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();
    render(<QuantityEditor item={item} onSave={onSave} onCancel={onCancel} />);

    fireEvent.press(screen.getByText('Cancel'));

    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
